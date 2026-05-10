import { existsSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, resolve as resolvePath, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import type { PhaseModelConfig } from "@pi-harness/shared";
import { readJsonl } from "../adapters/jsonl-writer.js";
import type { EventStore } from "../adapters/event-store.js";
import { mkEvent } from "../domain/events.js";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { BrainstormEventBus } from "./brainstorm-event-bus.js";
import {
  makeMarkReadyTool,
  makeReplyToUserTool,
  makeSubmitQuestionsTool,
} from "./brainstorm-tools.js";

// agents/ → src/ → orchestrator/ → apps/ → repo root → subagents/ours/brainstorm.md
// At dist-runtime: dist/agents → dist → orchestrator → apps → repo root.
// Both layouts have the same depth (4 levels up).
const HERE = dirname(fileURLToPath(import.meta.url));
const BRAINSTORM_PROMPT_PATH = resolvePath(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "subagents",
  "ours",
  "brainstorm.md",
);

export type CreateAgentSessionFn = (opts: AgentSessionOptions) => Promise<AgentSession>;

export type BrainstormOpts = {
  taskId: string;
  runId: string;
  cwd: string;
  store: ArtifactsStore;
  bus: BrainstormEventBus;
  eventStore: EventStore;
  phaseModel: PhaseModelConfig;
  sessionPath: string;
  createAgentSession: CreateAgentSessionFn;
  ticketTitle?: string;
  ticketDescription?: string;
  signal?: AbortSignal;
};
export type BrainstormResult = {
  ok: boolean;
  // True only when both artifacts have status: ready (mark_ready succeeded).
  ready: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  // Set when the tick aborted because of a user_cancel transition. The
  // dispatcher uses this to skip the failed-phase path: the route handler
  // already settled the run and emitted phase_ended cancelled.
  cancelled?: boolean;
};

type JsonlEvent = Record<string, unknown> & { ts?: string; kind?: string };

// A pending nudge: latest event for a given nudgeId where consumed:false.
type PendingNudge = { nudgeId: string; comment: string };

type Decision =
  | { kind: "noop" }
  | { kind: "initial"; nudges: PendingNudge[] }
  | { kind: "answers"; prompt: string; nudges: PendingNudge[] }
  | { kind: "revision"; prompt: string; nudges: PendingNudge[] }
  | { kind: "nudge_only"; nudges: PendingNudge[] };

type HaltReason = "questions" | "ready" | "exhausted";

// Drives one brainstorm tick: open or resume a real pi agent session, decide
// what to feed it from the JSONL log, drain the turn, and report whether the
// agent reached the ready state. Tool side-effects (publishing questions,
// flipping artifact status) are owned by the brainstorm-tools module; this
// function only inspects events to decide *why* the turn ended.
export async function runBrainstorm(opts: BrainstormOpts): Promise<BrainstormResult> {
  const events = await readJsonl<JsonlEvent>(
    join(opts.cwd, ".harness", opts.taskId, "brainstorm.jsonl"),
  );

  if (hasReadyEvent(events)) {
    return zeroUsage({ ok: true, ready: true });
  }

  const decision = decide(events);
  if (decision.kind === "noop") {
    return zeroUsage({ ok: true, ready: false });
  }

  // Mark every pending nudge as consumed *before* the prompt fires. This is
  // the durable record that the agent has now seen them — even if the prompt
  // fails or is aborted later, the next tick won't re-fold the same comments.
  for (const n of decision.nudges) {
    await opts.bus.publish({
      kind: "brainstorm_user_nudge",
      nudgeId: n.nudgeId,
      comment: n.comment,
      consumed: true,
    });
  }

  const basePrompt =
    decision.kind === "initial"
      ? buildInitialPrompt({
          taskId: opts.taskId,
          cwd: opts.cwd,
          ...(opts.ticketTitle !== undefined ? { title: opts.ticketTitle } : {}),
          ...(opts.ticketDescription !== undefined
            ? { description: opts.ticketDescription }
            : {}),
        })
      : decision.kind === "nudge_only"
        ? "Continue."
        : decision.prompt;

  const promptText = decision.nudges.length > 0
    ? `${buildNudgeBlock(decision.nudges)}\n\n${basePrompt}`
    : basePrompt;

  return runTurn(opts, promptText, opts.sessionPath, /* allowRetry */ true);
}

async function runTurn(
  opts: BrainstormOpts,
  promptText: string,
  sessionPath: string | undefined,
  allowRetry: boolean,
): Promise<BrainstormResult> {
  let haltReason: HaltReason = "exhausted";
  let lastWriteWasReady = false;

  const submitQuestionsTool = makeSubmitQuestionsTool({ bus: opts.bus });
  const markReadyTool = makeMarkReadyTool({
    store: opts.store,
    bus: opts.bus,
    cwd: opts.cwd,
    taskId: opts.taskId,
    countPendingNudges: async () => {
      const evts = await readJsonl<JsonlEvent>(
        join(opts.cwd, ".harness", opts.taskId, "brainstorm.jsonl"),
      );
      return pendingNudges(evts).length;
    },
  });
  const replyToUserTool = makeReplyToUserTool({ bus: opts.bus });

  const forwardToEventStore = (e: PiBridgeEvent): void => {
    // Forward streaming pi-bridge events (assistant text, generic tool calls,
    // logs) to EventStore so the dashboard's live Agent Log surfaces them.
    // Skip the two harness-internal control tools — brainstorm-tools already
    // publishes richer brainstorm_* events for those.
    if (e.kind === "turn_end" || e.kind === "error") return;
    if (
      (e.kind === "tool_call" || e.kind === "tool_result") &&
      (e.tool === "submit_questions" ||
        e.tool === "mark_ready" ||
        e.tool === "reply_to_user")
    ) {
      return;
    }
    const base = { runId: opts.runId, taskId: opts.taskId };
    let event;
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
    } else {
      return;
    }
    // Fire-and-forget: pi-bridge's onEvent is synchronous. Errors surface
    // through the EventStore's underlying logger; we don't want to block
    // streaming on a transient db hiccup.
    void opts.eventStore.append(event).catch(() => {});
  };

  const handleEvent = (e: PiBridgeEvent): void => {
    forwardToEventStore(e);
    if (e.kind === "tool_call" && e.tool === "submit_questions") {
      haltReason = "questions";
      return;
    }
    if (e.kind === "tool_result" && e.tool === "mark_ready") {
      // The tool's details encodes whether mark_ready was accepted. We watch
      // for ok:true to flip haltReason; a rejection (missing section) leaves
      // the agent free to write more and re-call mark_ready in the same turn.
      const out = e.output as { details?: { ok?: boolean } } | undefined;
      if (out?.details?.ok === true) {
        haltReason = "ready";
        lastWriteWasReady = true;
      }
      return;
    }
  };

  let systemPrompt: string;
  try {
    systemPrompt = readFileSync(BRAINSTORM_PROMPT_PATH, "utf8");
  } catch (err) {
    return zeroUsage({
      ok: false,
      ready: false,
      error: `brainstorm: cannot read system prompt: ${(err as Error).message}`,
    });
  }

  let session: AgentSession;
  try {
    session = await opts.createAgentSession({
      cwd: opts.cwd,
      model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
      ...(opts.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: opts.phaseModel.thinkingLevel }
        : {}),
      maxTurns: opts.phaseModel.maxTurns,
      systemPrompt,
      ...(sessionPath !== undefined ? { sessionPath } : {}),
      customTools: [submitQuestionsTool, markReadyTool, replyToUserTool],
      onEvent: handleEvent,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      await opts.bus.publish({
        kind: "brainstorm_system",
        systemKind: "blocked",
        data: { reason: err.message },
      });
      return zeroUsage({
        ok: false,
        ready: false,
        error: `missing API key for ${opts.phaseModel.provider}`,
      });
    }
    // Treat any other open-time error as a candidate corrupted-session-file
    // case. The bridge surfaces SessionManager.open failures synchronously
    // through createAgentSession; we delete the file and retry once with no
    // sessionPath so the conversation continues from the JSONL replay path.
    if (allowRetry && existsSync(opts.sessionPath)) {
      try {
        await unlink(opts.sessionPath);
        await opts.bus.publish({
          kind: "brainstorm_system",
          systemKind: "session_reset",
          data: { reason: (err as Error).message },
        });
        return runTurn(opts, promptText, undefined, /* allowRetry */ false);
      } catch {
        // fall through to error return
      }
    }
    return zeroUsage({
      ok: false,
      ready: false,
      error: (err as Error).message,
    });
  }

  // Cooperative cancellation: when the run-loop signals abort (user_cancel
  // landed), tear the SDK turn down at the session level so prompt() rejects
  // immediately rather than waiting on the LLM stream to finish.
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
    if (message === "maxTurns exceeded") {
      await opts.bus.publish({
        kind: "brainstorm_system",
        systemKind: "blocked",
        data: { reason: `maxTurns (${opts.phaseModel.maxTurns}) exceeded` },
      });
      return zeroUsage({
        ok: false,
        ready: false,
        error: "brainstorm: maxTurns exceeded",
      });
    }
    await opts.bus.publish({
      kind: "brainstorm_system",
      systemKind: "blocked",
      data: { reason: message },
    });
    return zeroUsage({ ok: false, ready: false, error: message });
  }

  signal?.removeEventListener("abort", onAbort);
  await session.close();

  // Emit per-tick usage. Cumulatives survive orchestrator restarts because we
  // re-read JSONL inside runBrainstorm and seed the totals from the latest
  // brainstorm_usage event. The bus dual-writes to JSONL + EventStore so the
  // cost strip on the dashboard updates live.
  if (usage.inputTokens > 0 || usage.outputTokens > 0 || usage.costUsd > 0) {
    const priorEvents = await readJsonl<JsonlEvent>(
      join(opts.cwd, ".harness", opts.taskId, "brainstorm.jsonl"),
    );
    let cumIn = 0;
    let cumOut = 0;
    let cumCost = 0;
    let lastTickIndex = -1;
    for (const e of priorEvents) {
      if (e.kind !== "brainstorm_usage") continue;
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
      kind: "brainstorm_usage",
      tickIndex: lastTickIndex + 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      cumulativeInputTokens: cumIn + usage.inputTokens,
      cumulativeOutputTokens: cumOut + usage.outputTokens,
      cumulativeCostUsd: cumCost + usage.costUsd,
    });
  }

  const [design, spec] = await Promise.all([
    opts.store.readArtifact(opts.cwd, opts.taskId, "design"),
    opts.store.readArtifact(opts.cwd, opts.taskId, "spec"),
  ]);
  const ready =
    lastWriteWasReady ||
    (design?.fm.status === "ready" && spec?.fm.status === "ready");

  // haltReason "exhausted" means the agent ended its turn without calling a
  // brainstorm-completing tool. Not a hard failure — the next answers-delta
  // tick (or user revision) will resume it. Surfaced via the result fields
  // for the run-loop / dashboard to log; we don't fail the tick.
  return {
    ok: true,
    ready: Boolean(ready),
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(haltReason === "exhausted" && !ready
      ? { error: "brainstorm: agent ended turn without questions or ready" }
      : {}),
  };
}

function decide(events: JsonlEvent[]): Decision {
  const nudges = pendingNudges(events);

  if (events.length === 0) return { kind: "initial", nudges };

  const lastAgentIdx = lastIndexWhere(
    events,
    (e) => e.kind === "brainstorm_question" || e.kind === "brainstorm_system",
  );

  // Revision wins over answers when both postdate the last agent activity:
  // a user requesting changes after answering means the answers belong to
  // the prior round and the agent should re-evaluate against the comment.
  const newRevisions = events
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => e.kind === "brainstorm_revision_requested" && i > lastAgentIdx);
  if (newRevisions.length > 0) {
    const last = newRevisions[newRevisions.length - 1]!.e;
    return {
      kind: "revision",
      prompt: buildRevisionPrompt(typeof last["comment"] === "string" ? (last["comment"] as string) : ""),
      nudges,
    };
  }

  const newAnswers = events
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => e.kind === "brainstorm_answer" && i > lastAgentIdx)
    .map(({ e }) => e);
  if (newAnswers.length > 0) {
    return { kind: "answers", prompt: buildAnswersDeltaPrompt(newAnswers), nudges };
  }

  // No initial event implies first dispatch; otherwise nothing new to feed
  // the agent — unless the user dropped a nudge, in which case the nudge
  // alone is enough to wake the agent for one turn.
  if (lastAgentIdx === -1) return { kind: "initial", nudges };
  if (nudges.length > 0) return { kind: "nudge_only", nudges };
  return { kind: "noop" };
}

// Walk the JSONL keeping the LAST event per nudgeId. A consumed:true event
// supersedes any earlier consumed:false for the same id, so it drops out
// of the pending list. Order in the returned array follows first-seen order
// of each nudgeId so multiple nudges fold in the order the user filed them.
function pendingNudges(events: JsonlEvent[]): PendingNudge[] {
  const seenOrder: string[] = [];
  const latest = new Map<string, JsonlEvent>();
  for (const e of events) {
    if (e.kind !== "brainstorm_user_nudge") continue;
    const id = typeof e["nudgeId"] === "string" ? (e["nudgeId"] as string) : null;
    if (!id) continue;
    if (!latest.has(id)) seenOrder.push(id);
    latest.set(id, e);
  }
  const out: PendingNudge[] = [];
  for (const id of seenOrder) {
    const e = latest.get(id)!;
    if (e["consumed"] === true) continue;
    const comment = typeof e["comment"] === "string" ? (e["comment"] as string) : "";
    out.push({ nudgeId: id, comment });
  }
  return out;
}

function buildNudgeBlock(nudges: PendingNudge[]): string {
  const lines = nudges.map((n) => `- [nudgeId: ${n.nudgeId}] ${n.comment}`).join("\n");
  return `Recent user input (consider before asking your next question):\n${lines}\n\nWhen you call reply_to_user, set inReplyToNudgeId to the bracketed id of the nudge you are responding to.`;
}

function buildInitialPrompt(opts: {
  taskId: string;
  cwd: string;
  title?: string;
  description?: string;
}): string {
  const parts: string[] = [];
  parts.push(`Begin brainstorming this task.`);
  if (opts.title) parts.push(`Title: ${opts.title}`);
  if (opts.description) parts.push(`Description: ${opts.description}`);
  parts.push(`Worktree: ${opts.cwd}`);
  parts.push(
    `Artifacts to author: .harness/${opts.taskId}/design.md and .harness/${opts.taskId}/spec.md.`,
  );
  parts.push(
    `Use submit_questions to ask the user everything you need before you start writing. After they answer, fill the artifacts and call mark_ready.`,
  );
  return parts.join("\n");
}

function buildAnswersDeltaPrompt(answers: JsonlEvent[]): string {
  const lines: string[] = ["User answered:"];
  for (const a of answers) {
    const id = String(a["questionId"] ?? "?");
    const optionId = a["optionId"];
    const optionIds = a["optionIds"];
    const freeText = a["freeText"];
    if (Array.isArray(optionIds) && optionIds.length > 0) {
      lines.push(`- ${id}: ${optionIds.join(", ")}`);
    } else if (typeof optionId === "string") {
      lines.push(`- ${id}: ${optionId}`);
    } else if (typeof freeText === "string") {
      lines.push(`- ${id}: ${freeText}`);
    } else {
      lines.push(`- ${id}: (no answer body)`);
    }
  }
  lines.push("", "Continue.");
  return lines.join("\n");
}

function buildRevisionPrompt(comment: string): string {
  return `User requested revisions: ${comment}\n\nRe-examine the artifacts and ask any clarifying questions you need before revising.`;
}

function hasReadyEvent(events: JsonlEvent[]): boolean {
  return events.some(
    (e) =>
      e.kind === "brainstorm_system" &&
      e["systemKind"] === "status_changed" &&
      ((e["data"] as { status?: string } | undefined)?.status === "ready"),
  );
}

function numField(e: JsonlEvent, key: string): number | null {
  const v = e[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function lastIndexWhere<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (pred(arr[i]!)) return i;
  }
  return -1;
}

function zeroUsage(partial: Partial<BrainstormResult> & { ok: boolean; ready: boolean }): BrainstormResult {
  return {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    ...partial,
  };
}
