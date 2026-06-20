import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import {
  type AgentEvent,
  type PhaseModelConfig,
} from "@pi-harness/shared";
import { getSubagent } from "@pi-harness/subagents";
import { makeGitHistoryTool } from "./git-history-tool.js";
import { makeWriteFindingsTool } from "./write-findings-tool.js";
import { makeSubagentFooter } from "./subagent-footer.js";
import {
  derivePlanExecutionState,
  type PlanArtifactsSnapshot,
  type PlannerDecision,
} from "./plan-state.js";
import { readJsonl } from "../adapters/jsonl-writer.js";
import type { EventStore } from "../adapters/event-store.js";
import type { PreflightStepStore } from "../adapters/preflight-step-store.js";
import type { ClaimLedgerStore } from "../adapters/mission-store.js";
import { mkEvent } from "../domain/events.js";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { PlanEventBus } from "./plan-event-bus.js";
import {
  makeMarkReadyTool,
  makeWritePlanArtifactTool,
  parseFalsifiedClaims,
  type ClaimPublisher,
  type ClaimVerifierState,
  type DispatchClaimVerifier,
} from "./plan-tools.js";
import { makeGraphifyTools } from "./graphify-tools.js";
import type { GraphifyService } from "../services/graphify-service.js";
import { makeSpawnPlanAgentTool } from "./plan-spawn-agent-tool.js";
import type {
  AgentSessionOptionsWithoutSessionPath,
  ManagedSessionFactory,
} from "../runner/phase-session-manager.js";

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
  preflightSteps?: PreflightStepStore;
  claimLedger?: ClaimLedgerStore;
  claimPublisher?: ClaimPublisher;
  phaseModel: PhaseModelConfig;
  sessionPath: string;
  createAgentSession: CreateAgentSessionFn;
  sessionFactory?: ManagedSessionFactory;
  graphify?: GraphifyService;
  graphifyQueryBudget?: number;
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
  onSubagentBridgeEvent?: (subagent: string, e: PiBridgeEvent) => void;
  preflightSubagentTimeoutMs?: number;
  preflightRetrySubagentTimeoutMs?: number;
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

const PLANNER_RECOVERY_CAP = 2;

// Drives one plan tick. The parent planner owns decomposition and may call
// spawn_plan_agent for bounded child research. mark_ready remains the only
// halt-causing custom tool: it validates artifacts, dispatches claim-verifier,
// and flips status to ready on success.
export async function runPlan(opts: PlanOpts): Promise<PlanResult> {
  const events = await readJsonl<JsonlEvent>(
    join(opts.cwd, ".harness", opts.taskId, "plan.jsonl"),
  );

  // Parent planner. Derive state from durable JSONL + artifact frontmatter
  // instead of trusting an in-memory run tick. A prior planner_started without
  // ready artifacts is recoverable, not a permanent no-op.
  const artifacts = await readPlanArtifacts(opts);
  const state = derivePlanExecutionState({
    events,
    artifacts,
    recoveryCap: PLANNER_RECOVERY_CAP,
  });
  const decision = state.plannerDecision;
  if (decision.kind === "ready") {
    return zeroUsage({ ok: true, ready: true });
  }
  if (decision.kind === "blocked") {
    await opts.bus.publish({
      kind: "plan_system",
      systemKind: "blocked",
      data: { reason: decision.reason, recoveryAttempts: state.recoveryAttempts },
    });
    return zeroUsage({ ok: false, ready: false, error: `plan: ${decision.reason}` });
  }

  return runPlannerStage(opts, {
    decision,
    prompt: buildPlannerPrompt(opts.cwd, opts.taskId, decision),
  });
}

function buildPlannerPrompt(cwd: string, taskId: string, decision: PlannerDecision): string {
  switch (decision.kind) {
    case "initial":
      return buildInitialPrompt(cwd, taskId);
    case "revision":
      return buildRevisionPrompt(cwd, taskId, decision.comment);
    case "recovery":
      return buildRecoveryPrompt(cwd, taskId, decision);
    case "blocked":
    case "ready":
      return "";
  }
}

function buildInitialPrompt(cwd: string, taskId: string): string {
  const paths = artifactPaths(cwd, taskId);
  return [
    "Begin the plan phase.",
    "",
    `1. Read design.md: ${paths.design}.`,
    `2. Read spec.md: ${paths.spec}.`,
    `3. Use spawn_plan_agent to launch the child agents you need. Start with a codebase-scout style child for local context, then spawn any focused follow-ups required by the design/spec. For every child, set title to a short, specific live display name for its assignment, such as "Session Resume Mapper"; do not use the role name or a generated id as the title.`,
    "4. Use the findings bodies returned by spawn_plan_agent. Do not write final plan artifacts until you have enough child evidence.",
    `5. Update blast-radius.yaml at ${paths.blastRadius} if the child findings reveal concrete impacted areas.`,
    `6. Author plan.md at ${paths.plan}, phase plans as ${paths.phasePlans}, scenarios.yaml at ${paths.scenarios}, and execution-dag.yaml at ${paths.executionDag} per the protocol in your system prompt.`,
    "7. Call mark_ready when all authored artifacts are complete and you have cross-checked your citations.",
  ].join("\n");
}

function buildRevisionPrompt(cwd: string, taskId: string, comment: string): string {
  const paths = artifactPaths(cwd, taskId);
  return [
    "The user has requested revisions to your plan:",
    "",
    `> ${comment}`,
    "",
    `Read your existing plan.md (${paths.plan}), any phase plans (${paths.phasePlans}), scenarios.yaml (${paths.scenarios}), execution-dag.yaml (${paths.executionDag}), and blast-radius.yaml (${paths.blastRadius}).`,
    "Revise plan.md, plan-N.md, scenarios.yaml, and execution-dag.yaml in place to address the comment, then call mark_ready again.",
    "",
    `The research findings under ${paths.researchDir} and blast-radius.yaml have not changed — use them as-is.`,
  ].join("\n");
}

function buildRecoveryPrompt(
  cwd: string,
  taskId: string,
  decision: Extract<PlannerDecision, { kind: "recovery" }>,
): string {
  const paths = artifactPaths(cwd, taskId);
  return [
    "Recover the plan phase.",
    "",
    `Recovery attempt: ${decision.attempt}/${PLANNER_RECOVERY_CAP}.`,
    `Reason: ${decision.reason}.`,
    "",
    "The previous planner turn did not leave ready artifacts. Continue from persisted files and finish the plan phase now.",
    "",
    `- design.md: ${paths.design}`,
    `- spec.md: ${paths.spec}`,
    `- blast-radius.yaml: ${paths.blastRadius}`,
    `- research directory: ${paths.researchDir}`,
    `- plan.md output: ${paths.plan}`,
    `- phase plan outputs: ${paths.phasePlans}`,
    `- scenarios.yaml output: ${paths.scenarios}`,
    `- execution-dag.yaml output: ${paths.executionDag}`,
    "",
    "Repair or complete plan.md, plan-N.md, scenarios.yaml, and execution-dag.yaml in place. Then call mark_ready. Do not stop after exploratory tool calls.",
  ].join("\n");
}

function artifactPaths(cwd: string, taskId: string): Record<string, string> {
  const root = join(cwd, ".harness", taskId);
  return {
    design: join(root, "design.md"),
    spec: join(root, "spec.md"),
    blastRadius: join(root, "blast-radius.yaml"),
    researchDir: join(root, "research"),
    plan: join(root, "plan.md"),
    phasePlans: join(root, "plan-N.md"),
    scenarios: join(root, "scenarios.yaml"),
    executionDag: join(root, "execution-dag.yaml"),
  };
}

// Test surface for the regression where a revision after ready must dispatch
// planner work again. Runtime uses derivePlanExecutionState; these helpers keep
// the small decision-matrix test independent from pi session setup.
export const __testing = {
  hasReadyEvent,
  hasRevisionAfterReady,
  decidePlannerPrompt,
};

function hasReadyEvent(events: JsonlEvent[]): boolean {
  return events.some(isReadyEvent);
}

function hasRevisionAfterReady(events: JsonlEvent[]): boolean {
  const lastReady = lastIndexWhere(events, isReadyEvent);
  const lastRevision = lastIndexWhere(events, isRevisionEvent);
  return lastRevision !== -1 && lastRevision > lastReady;
}

function decidePlannerPrompt(
  events: JsonlEvent[],
): { kind: "noop" } | { kind: "revision"; prompt: string } {
  if (!hasRevisionAfterReady(events)) return { kind: "noop" };
  const revision = [...events].reverse().find(isRevisionEvent);
  const comment = typeof revision?.comment === "string" ? revision.comment : "";
  return { kind: "revision", prompt: buildRevisionPrompt("", "", comment) };
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

function lastIndexWhere(
  events: readonly JsonlEvent[],
  predicate: (event: JsonlEvent) => boolean,
): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (predicate(events[i]!)) return i;
  }
  return -1;
}

async function readPlanArtifacts(opts: PlanOpts): Promise<PlanArtifactsSnapshot> {
  const [plan, phasePlans, scenarios, blastRadius, executionDag] = await Promise.all([
    opts.store.readArtifact(opts.cwd, opts.taskId, "plan"),
    opts.store.listPhasePlanArtifacts(opts.cwd, opts.taskId),
    opts.store.readArtifact(opts.cwd, opts.taskId, "scenarios"),
    opts.store.readArtifact(opts.cwd, opts.taskId, "blast-radius"),
    opts.store.readArtifact(opts.cwd, opts.taskId, "execution-dag"),
  ]);
  return { plan, phasePlans, scenarios, blastRadius, executionDag };
}

async function runPlannerStage(
  opts: PlanOpts,
  input: { readonly decision: PlannerDecision; readonly prompt: string },
): Promise<PlanResult> {
  const attemptId = `planner_${randomUUID()}`;
  await opts.bus.publish({
    kind: "plan_system",
    systemKind: "planner_started",
    data: {
      attemptId,
      mode: input.decision.kind,
      ...(input.decision.kind === "recovery"
        ? { recoveryAttempt: input.decision.attempt, reason: input.decision.reason }
        : {}),
    },
  });

  // Inner abort controller for any claim-verifier dispatch fired during this
  // planner turn. Fires when the outer run signal aborts so a slow audit
  // cannot run past a cancelled planner turn.
  const innerAbort = new AbortController();
  if (opts.signal?.aborted) innerAbort.abort();
  opts.signal?.addEventListener("abort", () => innerAbort.abort(), { once: true });

  // Build claim-verifier dispatcher closure. It runs the vendored
  // claim-verifier subagent with plan.md as input, writes findings to
  // research/claim-verifier.md, and parses Falsified entries. Capped via
  // claimVerifierState; the tool itself enforces the cap.
  const dispatchClaimVerifier: DispatchClaimVerifier = async (planBody: string) => {
    if (innerAbort.signal.aborted) {
      return { falsifiedClaims: [], findingsWritten: false, aborted: true };
    }
    const findingsPath = join(opts.cwd, ".harness", opts.taskId, "research", "claim-verifier.md");
    if (existsSync(findingsPath)) {
      // Re-dispatch: clear stale findings so the next attempt starts fresh.
      await unlink(findingsPath).catch(() => {});
    }
    const cvDef = getSubagent("claim-verifier");
    const systemPrompt = `${readFileSync(cvDef.promptPath, "utf8")}\n\n${makeSubagentFooter({ hasGitHistory: true })}\n`;
    const userPrompt = [
      `You are auditing the plan for task ${opts.taskId}. Read the plan below and tag every claim as Verified, Weakened, or Falsified per your system prompt.`,
      ``,
      `Persist your findings via the \`write_findings\` tool using the standard claim-verifier output format. This is mandatory — if you finish your audit without calling write_findings, the harness will reject mark_ready.`,
      ``,
      `# plan.md`,
      ``,
      planBody,
    ].join("\n");

    const sessionId = `psa_${randomUUID()}`;
    const startedAt = Date.now();
    await opts.bus.publish({
      kind: "plan_subagent_started",
      subagent: "claim-verifier",
      sessionId,
    });

    // Forward claim-verifier bridge events to EventStore so the dashboard's
    // per-agent drawer can show its tool-call stream. Mirrors the preflight
    // forwarder in this file. Skip turn_end / error (control-plane only) and
    // write_findings (we publish richer bus events for that lifecycle).
    const cvForward = (e: PiBridgeEvent): void => {
      if (e.kind === "turn_end" || e.kind === "error" || e.kind === "usage_update") return;
      const base = { runId: opts.runId, taskId: opts.taskId };
      const subagent = "claim-verifier";
      let event: AgentEvent | null = null;
      if (e.kind === "message_delta") {
        event = mkEvent({ ...base, kind: "message_delta", text: e.text, subagent });
      } else if (e.kind === "tool_call") {
        event = mkEvent({ ...base, kind: "tool_call", callId: e.callId, tool: e.tool, input: e.input, subagent });
      } else if (e.kind === "tool_result") {
        event = mkEvent({
          ...base,
          kind: "tool_result",
          callId: e.callId,
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

    let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    let dispatchError: string | undefined;
    let cvSession: AgentSession | null = null;
    let promptPromise: Promise<{ costUsd: number; inputTokens: number; outputTokens: number }> | undefined;
    const onCvAbort = (): void => {
      void cvSession?.abort().catch(() => {});
    };
    innerAbort.signal.addEventListener("abort", onCvAbort, { once: true });
    const cvGraphifyTools = opts.graphify
      ? makeGraphifyTools({
          graphify: opts.graphify,
          defaultBudget: opts.graphifyQueryBudget ?? 2000,
        })
      : [];
    try {
      const cvSessionOpts: AgentSessionOptionsWithoutSessionPath = {
        cwd: opts.cwd,
        model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
        ...(opts.phaseModel.thinkingLevel !== "off"
          ? { thinkingLevel: opts.phaseModel.thinkingLevel }
          : {}),
        systemPrompt,
        // SDK `tools` is an absolute allowlist that filters custom tools too —
        // see plan-preflight.ts for the same fix.
        tools: [
          ...cvDef.allowedTools,
          "git_history",
          "write_findings",
          ...cvGraphifyTools.map((tool) => tool.name),
        ],
        customTools: [
          makeGitHistoryTool({ cwd: opts.cwd }),
          makeWriteFindingsTool({ cwd: opts.cwd, taskId: opts.taskId, subagent: "claim-verifier" }),
          ...cvGraphifyTools,
        ],
        onEvent: cvForward,
      };
      cvSession = opts.sessionFactory
        ? await opts.sessionFactory.open({ kind: "claim-verifier" }, cvSessionOpts)
        : await opts.createAgentSession(cvSessionOpts);
      try {
        promptPromise = cvSession.prompt(userPrompt);
        usage = await promptPromise;
      } finally {
        void promptPromise?.catch(() => {});
        await cvSession.close().catch(() => {});
      }
    } catch (err) {
      dispatchError = (err as Error).message;
    } finally {
      innerAbort.signal.removeEventListener("abort", onCvAbort);
    }

    const aborted = innerAbort.signal.aborted;
    const findingsWritten = existsSync(findingsPath);
    await opts.bus.publish({
      kind: "plan_subagent_ended",
      subagent: "claim-verifier",
      sessionId,
      ok: findingsWritten && dispatchError === undefined && !aborted,
      durationMs: Date.now() - startedAt,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(dispatchError !== undefined
        ? { error: dispatchError }
        : aborted
          ? { error: "claim-verifier aborted by planner timeout" }
          : {}),
    });

    if (aborted) {
      return { falsifiedClaims: [], findingsWritten: false, aborted: true };
    }
    if (!findingsWritten) {
      return { falsifiedClaims: [], findingsWritten: false };
    }
    const findings = readFileSync(findingsPath, "utf8");
    return {
      falsifiedClaims: parseFalsifiedClaims(findings),
      findingsWritten: true,
    };
  };

  const markReadyTool = makeMarkReadyTool({
    store: opts.store,
    bus: opts.bus,
    cwd: opts.cwd,
    taskId: opts.taskId,
    dispatchClaimVerifier,
    claimVerifierState: opts.claimVerifierState,
    cancelSignal: innerAbort.signal,
    ...(opts.claimLedger !== undefined ? { claimLedger: opts.claimLedger } : {}),
    ...(opts.claimPublisher !== undefined ? { claimPublisher: opts.claimPublisher } : {}),
  });
  const writePlanArtifactTool = makeWritePlanArtifactTool({
    store: opts.store,
    cwd: opts.cwd,
    taskId: opts.taskId,
  });
  let childUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const spawnPlanAgentTool = makeSpawnPlanAgentTool({
    cwd: opts.cwd,
    taskId: opts.taskId,
    runId: opts.runId,
    phaseModel: opts.phaseModel,
    bus: opts.bus,
    eventStore: opts.eventStore,
    createAgentSession: opts.createAgentSession,
    ...(opts.sessionFactory !== undefined ? { sessionFactory: opts.sessionFactory } : {}),
    ...(opts.graphify !== undefined ? { graphify: opts.graphify } : {}),
    ...(opts.graphifyQueryBudget !== undefined ? { graphifyQueryBudget: opts.graphifyQueryBudget } : {}),
    ...(innerAbort.signal !== undefined ? { parentSignal: innerAbort.signal } : {}),
    onUsage: (usage) => {
      childUsage = {
        inputTokens: childUsage.inputTokens + usage.inputTokens,
        outputTokens: childUsage.outputTokens + usage.outputTokens,
        costUsd: childUsage.costUsd + usage.costUsd,
      };
    },
  });

  let systemPrompt: string;
  let planDef: ReturnType<typeof getSubagent>;
  try {
    planDef = getSubagent("plan");
    systemPrompt = readFileSync(planDef.promptPath, "utf8");
  } catch (err) {
    return zeroUsage({
      ok: false,
      ready: false,
      error: `plan: cannot read system prompt: ${(err as Error).message}`,
    });
  }

  const sessionPath = opts.sessionPath;
  const graphifyTools = opts.graphify
    ? makeGraphifyTools({
        graphify: opts.graphify,
        defaultBudget: opts.graphifyQueryBudget ?? 2000,
      })
    : [];
  const sessionOpts: AgentSessionOptionsWithoutSessionPath = {
    cwd: opts.cwd,
    model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
    ...(opts.phaseModel.thinkingLevel !== "off"
      ? { thinkingLevel: opts.phaseModel.thinkingLevel }
      : {}),
    systemPrompt,
    tools: [
      ...planDef.allowedTools,
      "spawn_plan_agent",
      "write_plan_artifact",
      "mark_ready",
      ...graphifyTools.map((tool) => tool.name),
    ],
    customTools: [
      spawnPlanAgentTool,
      writePlanArtifactTool,
      markReadyTool,
      ...graphifyTools,
    ],
    onEvent: (e: PiBridgeEvent) => {
      // Forward planner-session bridge events to EventStore (no subagent
      // tag — the dashboard treats untagged events as planner output).
      // Skip turn_end / error (internal) and mark_ready (planner publishes
      // richer plan_* events for that one).
      if (e.kind === "turn_end" || e.kind === "error" || e.kind === "usage_update") return;
      if (
        (e.kind === "tool_call" || e.kind === "tool_result") &&
        (
          e.tool === "mark_ready" ||
          e.tool === "spawn_plan_agent" ||
          e.tool === "write_plan_artifact"
        )
      ) {
        return;
      }
      const base = { runId: opts.runId, taskId: opts.taskId };
      let event: AgentEvent | null = null;
      if (e.kind === "message_delta") {
        event = mkEvent({ ...base, kind: "message_delta", text: e.text });
      } else if (e.kind === "tool_call") {
        event = mkEvent({ ...base, kind: "tool_call", callId: e.callId, tool: e.tool, input: e.input });
      } else if (e.kind === "tool_result") {
        event = mkEvent({
          ...base,
          kind: "tool_result",
          callId: e.callId,
          tool: e.tool,
          ok: e.ok,
          ...(e.output !== undefined ? { output: e.output } : {}),
        });
      } else if (e.kind === "log") {
        event = mkEvent({ ...base, kind: "log", level: e.level, text: e.text });
      }
      if (event) void opts.eventStore.append(event).catch(() => {});
    },
  };

  let session: AgentSession;
  try {
    session = opts.sessionFactory
      ? await opts.sessionFactory.open({ kind: "main" }, sessionOpts)
      : await opts.createAgentSession({ ...sessionOpts, sessionPath });
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
    const parentUsage = await session.prompt(input.prompt);
    usage = {
      inputTokens: parentUsage.inputTokens + childUsage.inputTokens,
      outputTokens: parentUsage.outputTokens + childUsage.outputTokens,
      costUsd: parentUsage.costUsd + childUsage.costUsd,
    };
  } catch (err) {
    signal?.removeEventListener("abort", onAbort);
    innerAbort.abort();
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

  await opts.bus.publish({
    kind: "plan_system",
    systemKind: "planner_turn_completed",
    data: { attemptId, ready: Boolean(ready) },
  });

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
