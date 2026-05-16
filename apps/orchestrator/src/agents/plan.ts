import { existsSync, readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import {
  BlastRadiusFileSchema,
  type AgentEvent,
  type PhaseModelConfig,
} from "@pi-harness/shared";
import { getSubagent, PREFLIGHT_SUBAGENTS } from "@pi-harness/subagents";
import { makeWriteFindingsTool } from "./write-findings-tool.js";
import { SUBAGENT_FOOTER } from "./subagent-footer.js";
import { readJsonl } from "../adapters/jsonl-writer.js";
import type { EventStore } from "../adapters/event-store.js";
import { mkEvent } from "../domain/events.js";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { PlanEventBus } from "./plan-event-bus.js";
import {
  makeMarkReadyTool,
  parseFalsifiedClaims,
  type ClaimVerifierState,
  type DispatchClaimVerifier,
} from "./plan-tools.js";
import {
  runPreflight,
  type PreflightResult,
  type PreflightSubagent,
  type PreflightSubagentEvent,
} from "./plan-preflight.js";

export type CreateAgentSessionFn = (opts: AgentSessionOptions) => Promise<AgentSession>;

export type PlanOpts = {
  taskId: string;
  runId: string;
  cwd: string;
  store: ArtifactsStore;
  bus: PlanEventBus;
  // EventStore is needed alongside the bus because pi-bridge tool_call /
  // tool_result events go straight to EventStore (not the JSONL plan log).
  // Mirrors brainstorm's split: control-plane events on the bus, raw bridge
  // events on the store.
  eventStore: EventStore;
  phaseModel: PhaseModelConfig;
  sessionPath: string;
  createAgentSession: CreateAgentSessionFn;
  ticketTitle: string;
  ticketDescription: string;
  signal?: AbortSignal;
  // Mutable per-run state that survives multiple ticks within the same Run
  // (mark_ready may dispatch claim-verifier across multiple tool calls in
  // one turn). The run-loop creates this once per run and threads it through.
  claimVerifierState: ClaimVerifierState;
  // Optional override for tests. Production callers leave this unset and the
  // driver wires its own forwarder that tags events with the subagent name
  // and pushes them to EventStore.
  onSubagentBridgeEvent?: (subagent: PreflightSubagent, e: PiBridgeEvent) => void;
};

export type PlanResult = {
  ok: boolean;
  ready: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  cancelled?: boolean;
};

type JsonlEvent = Record<string, unknown> & { ts?: string; kind?: string };

// Drives one plan tick. Two-stage shape:
//
//   Stage 1 (preflight): runPreflight dispatches the seven research
//   subagents (skipping any whose findings file already exists). On
//   completion, returns ok:true with ready:false so the run-loop re-enters
//   for the planner stage.
//
//   Stage 2 (planner): opens or resumes a real pi session at
//   pi-session-plan.jsonl, reads the chosen prompt (initial or revision),
//   drains one prompt(), and reports usage. The mark_ready tool is the only
//   halt-causing custom tool — its handler validates artifacts + dispatches
//   claim-verifier and flips status to ready on success.
export async function runPlan(opts: PlanOpts): Promise<PlanResult> {
  const events = await readJsonl<JsonlEvent>(
    join(opts.cwd, ".harness", opts.taskId, "plan.jsonl"),
  );

  if (hasReadyEvent(events)) {
    return zeroUsage({ ok: true, ready: true });
  }

  // Stage 1: preflight. We're done with stage 1 once every subagent's findings
  // file exists. The "preflight_complete" event is published once when the
  // last missing findings file lands, so any tick after that goes straight to
  // the planner.
  if (!(await isPreflightComplete(opts))) {
    return runPreflightStage(opts);
  }

  // Stage 2: planner. Decide between initial prompt and revision prompt based
  // on the JSONL ordering — the same revision-after-ready logic the gate uses,
  // but here the planner needs the comment to fold into its next prompt.
  const decision = decidePlannerPrompt(events);
  if (decision.kind === "noop") {
    return zeroUsage({ ok: true, ready: false });
  }

  return runPlannerStage(opts, decision.prompt);
}

type PlannerDecision =
  | { kind: "noop" }
  | { kind: "initial"; prompt: string }
  | { kind: "revision"; prompt: string };

function decidePlannerPrompt(events: JsonlEvent[]): PlannerDecision {
  // First-ever planner tick: no plan_system{planner_started} yet.
  const hasPlannerStarted = events.some(
    (e) => e.kind === "plan_system" && e["systemKind"] === "planner_started",
  );

  // The most-recent revision request that postdates the most-recent ready
  // event is the trigger for a revision turn.
  const lastReadyIdx = lastIndexWhere(events, isReadyEvent);
  const lastRevisionIdx = lastIndexWhere(events, isRevisionEvent);
  const hasNewRevision = lastRevisionIdx !== -1 && lastRevisionIdx > lastReadyIdx;

  if (hasNewRevision) {
    const e = events[lastRevisionIdx]!;
    const comment = typeof e["comment"] === "string" ? (e["comment"] as string) : "";
    return { kind: "revision", prompt: buildRevisionPrompt(comment) };
  }

  if (!hasPlannerStarted) {
    return { kind: "initial", prompt: buildInitialPrompt() };
  }

  return { kind: "noop" };
}

function buildInitialPrompt(): string {
  return [
    "Begin the plan phase.",
    "",
    "1. Read design.md and spec.md from .harness/<this task>/.",
    "2. Read blast-radius.yaml from .harness/<this task>/.",
    `3. Read every file under .harness/<this task>/research/ — there are ${PREFLIGHT_SUBAGENTS.length} research findings, one per subagent.`,
    "4. Author plan.md and scenarios.yaml per the protocol in your system prompt.",
    "5. Call mark_ready when both authored artifacts are complete and you have cross-checked your citations.",
  ].join("\n");
}

function buildRevisionPrompt(comment: string): string {
  return [
    "The user has requested revisions to your plan:",
    "",
    `> ${comment}`,
    "",
    "Read your existing plan.md, scenarios.yaml, and blast-radius.yaml, revise plan.md/scenarios.yaml in place to address the comment, then call mark_ready again.",
    "",
    "The research findings under .harness/<task>/research/ and blast-radius.yaml have not changed — use them as-is.",
  ].join("\n");
}

function hasReadyEvent(events: JsonlEvent[]): boolean {
  return events.some(isReadyEvent);
}

function isReadyEvent(e: JsonlEvent): boolean {
  if (e.kind !== "plan_system") return false;
  if (e["systemKind"] !== "status_changed") return false;
  const data = e["data"] as { status?: string } | undefined;
  return data?.status === "ready";
}

function isRevisionEvent(e: JsonlEvent): boolean {
  return e.kind === "plan_revision_requested";
}

function lastIndexWhere<T>(arr: T[], pred: (e: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i]!)) return i;
  }
  return -1;
}

async function isPreflightComplete(opts: PlanOpts): Promise<boolean> {
  const blastRadius = await opts.store.readArtifact(opts.cwd, opts.taskId, "blast-radius");
  return (
    missingPreflightFindings(opts.cwd, opts.taskId).length === 0 &&
    Boolean(blastRadius && isValidBlastRadiusBody(blastRadius.body))
  );
}

function missingPreflightFindings(cwd: string, taskId: string): string[] {
  const researchDir = join(cwd, ".harness", taskId, "research");
  return PREFLIGHT_SUBAGENTS.filter((sa) => {
    const path = join(researchDir, `${sa}.md`);
    if (!existsSync(path)) return true;
    return readFileSync(path, "utf8").trim().length === 0;
  });
}

function isValidBlastRadiusBody(body: string): boolean {
  try {
    return BlastRadiusFileSchema.safeParse(yaml.load(body)).success;
  } catch {
    return false;
  }
}

async function runPreflightStage(opts: PlanOpts): Promise<PlanResult> {
  await opts.bus.publish({
    kind: "plan_system",
    systemKind: "preflight_started",
  });

  const [design, spec] = await Promise.all([
    opts.store.readArtifact(opts.cwd, opts.taskId, "design"),
    opts.store.readArtifact(opts.cwd, opts.taskId, "spec"),
  ]);
  if (!design || !spec) {
    await opts.bus.publish({
      kind: "plan_system",
      systemKind: "blocked",
      data: { reason: "design.md or spec.md missing — brainstorm not approved?" },
    });
    return zeroUsage({
      ok: false,
      ready: false,
      error: "plan: missing brainstorm artifacts",
    });
  }

  // Default forwarder: tag every bridge event with the subagent name and push
  // it to EventStore so the dashboard's per-agent drawer can filter by
  // subagent. Skip turn_end / error (control-plane only) and the harness's
  // own custom-tool calls (planner publishes richer events for those).
  // Tests can pass their own onSubagentBridgeEvent to assert ordering.
  const defaultForward = (subagent: PreflightSubagent, e: PiBridgeEvent): void => {
    if (e.kind === "turn_end" || e.kind === "error") return;
    const base = { runId: opts.runId, taskId: opts.taskId };
    let event: AgentEvent | null = null;
    if (e.kind === "message_delta") {
      event = mkEvent({ ...base, kind: "message_delta", text: e.text, subagent });
    } else if (e.kind === "tool_call") {
      event = mkEvent({ ...base, kind: "tool_call", tool: e.tool, input: e.input, subagent });
    } else if (e.kind === "tool_result") {
      event = mkEvent({
        ...base,
        kind: "tool_result",
        tool: e.tool,
        ok: e.ok,
        ...(e.output !== undefined ? { output: e.output } : {}),
        subagent,
      });
    } else if (e.kind === "log") {
      event = mkEvent({ ...base, kind: "log", level: e.level, text: e.text, subagent });
    }
    if (event) void opts.eventStore.append(event).catch(() => {});
  };

  let result: PreflightResult;
  try {
    result = await runPreflight({
      cwd: opts.cwd,
      taskId: opts.taskId,
      ticketTitle: opts.ticketTitle,
      ticketDescription: opts.ticketDescription,
      designBody: design.body,
      specBody: spec.body,
      phaseModel: opts.phaseModel,
      createAgentSession: opts.createAgentSession,
      onSubagentBridgeEvent: opts.onSubagentBridgeEvent ?? defaultForward,
      onSubagentEvent: async (e: PreflightSubagentEvent) => {
        if (e.kind === "started") {
          await opts.bus.publish({
            kind: "plan_subagent_started",
            subagent: e.subagent,
            sessionId: e.sessionId,
          });
        } else {
          await opts.bus.publish({
            kind: "plan_subagent_ended",
            subagent: e.subagent,
            sessionId: e.sessionId,
            ok: e.ok,
            durationMs: e.durationMs,
            costUsd: e.costUsd,
            inputTokens: e.inputTokens,
            outputTokens: e.outputTokens,
            ...(e.error !== undefined ? { error: e.error } : {}),
          });
        }
      },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      await opts.bus.publish({
        kind: "plan_system",
        systemKind: "blocked",
        data: { reason: err.message },
      });
      return zeroUsage({
        ok: false,
        ready: false,
        error: `plan preflight: ${err.message}`,
      });
    }
    throw err;
  }

  // Sum up usage across the subagents.
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const r of result.results) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    costUsd += r.costUsd;
  }

  if (result.cancelled) {
    return {
      ok: false,
      ready: false,
      cancelled: true,
      inputTokens,
      outputTokens,
      costUsd,
    };
  }

  if (result.failed) {
    const failed = result.results.filter((r) => !r.ok).map((r) => r.subagent);
    await opts.bus.publish({
      kind: "plan_system",
      systemKind: "blocked",
      data: {
        reason: `preflight: required findings missing or failed (${failed.join(", ")})`,
        subagents: failed,
      },
    });
    return {
      ok: false,
      ready: false,
      error: `plan preflight: required findings missing or failed (${failed.join(", ")})`,
      inputTokens,
      outputTokens,
      costUsd,
    };
  }

  const preflightComplete = await isPreflightComplete(opts);
  const missing = [
    ...missingPreflightFindings(opts.cwd, opts.taskId),
    ...(preflightComplete ? [] : ["blast-radius.yaml"]),
  ];
  if (missing.length > 0) {
    await opts.bus.publish({
      kind: "plan_system",
      systemKind: "blocked",
      data: {
        reason: `preflight: missing findings (${missing.join(", ")})`,
        subagents: missing,
      },
    });
    return {
      ok: false,
      ready: false,
      error: `plan preflight: missing findings (${missing.join(", ")})`,
      inputTokens,
      outputTokens,
      costUsd,
    };
  }

  await opts.bus.publish({
    kind: "plan_system",
    systemKind: "preflight_complete",
    data: { count: result.results.length },
  });

  return { ok: true, ready: false, inputTokens, outputTokens, costUsd };
}

async function runPlannerStage(opts: PlanOpts, promptText: string): Promise<PlanResult> {
  await opts.bus.publish({
    kind: "plan_system",
    systemKind: "planner_started",
  });

  // Build claim-verifier dispatcher closure. It runs the vendored
  // claim-verifier subagent with plan.md as input, writes findings to
  // research/claim-verifier.md, and parses Falsified entries. Capped via
  // claimVerifierState; the tool itself enforces the cap.
  const dispatchClaimVerifier: DispatchClaimVerifier = async (planBody: string) => {
    const findingsPath = join(opts.cwd, ".harness", opts.taskId, "research", "claim-verifier.md");
    if (existsSync(findingsPath)) {
      // Re-dispatch: clear stale findings so the next attempt starts fresh.
      await unlink(findingsPath).catch(() => {});
    }
    const cvDef = getSubagent("claim-verifier");
    const systemPrompt = `${readFileSync(cvDef.promptPath, "utf8")}\n\n${SUBAGENT_FOOTER}\n`;
    const userPrompt = [
      `You are auditing the plan for task ${opts.taskId}. Read the plan below and tag every claim as Verified, Weakened, or Falsified per your system prompt.`,
      ``,
      `Persist your findings via the \`write_findings\` tool using the standard claim-verifier output format.`,
      ``,
      `# plan.md`,
      ``,
      planBody,
    ].join("\n");

    const session = await opts.createAgentSession({
      cwd: opts.cwd,
      model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
      ...(opts.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: opts.phaseModel.thinkingLevel }
        : {}),
      systemPrompt,
      tools: [...cvDef.allowedTools],
      customTools: [
        makeWriteFindingsTool({ cwd: opts.cwd, taskId: opts.taskId, subagent: "claim-verifier" }),
      ],
      onEvent: () => {},
    });
    try {
      await session.prompt(userPrompt);
    } finally {
      await session.close().catch(() => {});
    }
    if (!existsSync(findingsPath)) {
      return { falsifiedClaims: [] };
    }
    const findings = readFileSync(findingsPath, "utf8");
    return { falsifiedClaims: parseFalsifiedClaims(findings) };
  };

  const markReadyTool = makeMarkReadyTool({
    store: opts.store,
    bus: opts.bus,
    cwd: opts.cwd,
    taskId: opts.taskId,
    dispatchClaimVerifier,
    claimVerifierState: opts.claimVerifierState,
  });

  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(getSubagent("plan").promptPath, "utf8");
  } catch (err) {
    return zeroUsage({
      ok: false,
      ready: false,
      error: `plan: cannot read system prompt: ${(err as Error).message}`,
    });
  }

  const sessionPath = opts.sessionPath;
  let session: AgentSession;
  try {
    session = await opts.createAgentSession({
      cwd: opts.cwd,
      model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
      ...(opts.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: opts.phaseModel.thinkingLevel }
        : {}),
      systemPrompt,
      sessionPath,
      customTools: [markReadyTool],
      onEvent: (e: PiBridgeEvent) => {
        // Forward planner-session bridge events to EventStore (no subagent
        // tag — the dashboard treats untagged events as planner output).
        // Skip turn_end / error (internal) and mark_ready (planner publishes
        // richer plan_* events for that one).
        if (e.kind === "turn_end" || e.kind === "error") return;
        if (
          (e.kind === "tool_call" || e.kind === "tool_result") &&
          e.tool === "mark_ready"
        ) {
          return;
        }
        const base = { runId: opts.runId, taskId: opts.taskId };
        let event: AgentEvent | null = null;
        if (e.kind === "message_delta") {
          event = mkEvent({ ...base, kind: "message_delta", text: e.text });
        } else if (e.kind === "tool_call") {
          event = mkEvent({ ...base, kind: "tool_call", tool: e.tool, input: e.input });
        } else if (e.kind === "tool_result") {
          event = mkEvent({
            ...base,
            kind: "tool_result",
            tool: e.tool,
            ok: e.ok,
            ...(e.output !== undefined ? { output: e.output } : {}),
          });
        } else if (e.kind === "log") {
          event = mkEvent({ ...base, kind: "log", level: e.level, text: e.text });
        }
        if (event) void opts.eventStore.append(event).catch(() => {});
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      await opts.bus.publish({
        kind: "plan_system",
        systemKind: "blocked",
        data: { reason: err.message },
      });
      return zeroUsage({
        ok: false,
        ready: false,
        error: `missing API key for ${opts.phaseModel.provider}`,
      });
    }
    return zeroUsage({
      ok: false,
      ready: false,
      error: (err as Error).message,
    });
  }

  const signal = opts.signal;
  const onAbort = (): void => {
    void session.abort().catch(() => {});
  };
  if (signal?.aborted) {
    await session.close().catch(() => {});
    return zeroUsage({ ok: false, ready: false, cancelled: true });
  }
  signal?.addEventListener("abort", onAbort, { once: true });

  let usage = { costUsd: 0, inputTokens: 0, outputTokens: 0 };
  try {
    usage = await session.prompt(promptText);
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    await session.close().catch(() => {});
    const message = (err as Error).message;
    if (signal?.aborted || message === "aborted") {
      return zeroUsage({ ok: false, ready: false, cancelled: true });
    }
    await opts.bus.publish({
      kind: "plan_system",
      systemKind: "blocked",
      data: { reason: message },
    });
    return zeroUsage({ ok: false, ready: false, error: message });
  }

  signal?.removeEventListener("abort", onAbort);
  await session.close();

  // Per-tick usage event. Cumulatives survive orchestrator restarts because
  // we re-read plan.jsonl on every runPlan invocation and seed totals from
  // the latest plan_usage event.
  if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.costUsd > 0) {
    const priorEvents = await readJsonl<JsonlEvent>(
      join(opts.cwd, ".harness", opts.taskId, "plan.jsonl"),
    );
    let cumIn = 0;
    let cumOut = 0;
    let cumCost = 0;
    let lastTickIndex = -1;
    for (const e of priorEvents) {
      if (e.kind !== "plan_usage") continue;
      const ci = numField(e, "cumulativeInputTokens");
      const co = numField(e, "cumulativeOutputTokens");
      const cc = numField(e, "cumulativeCostUsd");
      const ti = numField(e, "tickIndex");
      if (ci !== null) cumIn = ci;
      if (co !== null) cumOut = co;
      if (cc !== null) cumCost = cc;
      if (ti !== null && ti > lastTickIndex) lastTickIndex = ti;
    }
    await opts.bus.publish({
      kind: "plan_usage",
      tickIndex: lastTickIndex + 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      cumulativeInputTokens: cumIn + usage.inputTokens,
      cumulativeOutputTokens: cumOut + usage.outputTokens,
      cumulativeCostUsd: cumCost + usage.costUsd,
    });
  }

  // Re-read artifacts to determine ready-ness, since mark_ready may have
  // succeeded inside the prompt without our switch logic seeing it (we
  // don't subscribe to bridge events in the planner stage; the bus does
  // the publishing internally).
  const [plan, scenarios, blastRadius] = await Promise.all([
    opts.store.readArtifact(opts.cwd, opts.taskId, "plan"),
    opts.store.readArtifact(opts.cwd, opts.taskId, "scenarios"),
    opts.store.readArtifact(opts.cwd, opts.taskId, "blast-radius"),
  ]);
  const ready =
    plan?.fm.status === "ready" &&
    scenarios?.fm.status === "ready" &&
    blastRadius?.fm.status === "ready";

  return {
    ok: true,
    ready: Boolean(ready),
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

function numField(e: JsonlEvent, k: string): number | null {
  const v = (e as Record<string, unknown>)[k];
  return typeof v === "number" ? v : null;
}

function zeroUsage(rest: Omit<PlanResult, "costUsd" | "inputTokens" | "outputTokens">): PlanResult {
  return { ...rest, costUsd: 0, inputTokens: 0, outputTokens: 0 };
}

// Helper: write a placeholder file to ensure parent directory exists when
// callers want to seed an empty findings file (used in tests).
export async function _ensureResearchFile(cwd: string, taskId: string, name: string): Promise<void> {
  const path = join(cwd, ".harness", taskId, "research", name);
  await writeFile(path, "# placeholder\n");
}
