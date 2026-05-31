// Pure fold: (parsed DAG + ordered AgentEvent[]) → render-ready code-phase state.
//
// The coder page has no dedicated bundle endpoint; every per-node status,
// transcript, and metric is derived here from the live event stream. Keeping
// this a pure function (no React, no I/O) makes the page's core logic trivially
// testable and lets the component layer stay dumb.

import type { AgentEvent } from "@pi-harness/shared";
import {
  groupNodesByPhase,
  type NodeSafety,
  type ParsedDag,
  type ParsedDagNode,
  type WavePolicy,
} from "./parse-execution-dag";

export type NodeStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";
export type WaveState = "done" | "running" | "pending";

export type CodeTranscriptItem =
  | { readonly kind: "message"; readonly id: string; readonly ts: Date; readonly text: string }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly ts: Date;
      readonly callId: string;
      readonly tool: string;
      readonly input: unknown;
      readonly status: "running" | "ok" | "error";
      readonly output?: unknown;
      readonly durationMs?: number;
    }
  | { readonly kind: "commit"; readonly id: string; readonly ts: Date; readonly commitSha: string }
  | {
      readonly kind: "log";
      readonly id: string;
      readonly ts: Date;
      readonly level: "info" | "warn" | "error";
      readonly text: string;
    };

export type CodeNodeView = {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly lane: string;
  readonly safety: NodeSafety;
  readonly dependsOn: readonly string[];
  readonly assertion: string | null;
  readonly status: NodeStatus;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly durationMs: number | null;
  readonly commitSha: string | null;
  readonly error: string | null;
  readonly sessionId: string | null;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly transcript: readonly CodeTranscriptItem[];
  readonly subLine: string;
  readonly toolCallCount: number;
  readonly editCount: number;
};

export type CodeWaveView = {
  readonly id: string;
  readonly name: string;
  readonly policy: WavePolicy;
  readonly nodes: readonly CodeNodeView[];
  readonly state: WaveState;
};

export type CodeMetrics = {
  readonly waveCurrent: number;
  readonly waveTotal: number;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly commitCount: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCostUsd: number;
};

export type CodeState = {
  readonly waves: readonly CodeWaveView[];
  readonly nodesById: ReadonlyMap<string, CodeNodeView>;
  readonly metrics: CodeMetrics;
  readonly autoSelectedNodeId: string | null;
};

// Mutable accumulator used only inside the fold; never escapes this module.
type NodeAccumulator = {
  status: NodeStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMs: number | null;
  commitSha: string | null;
  error: string | null;
  sessionId: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  transcript: CodeTranscriptItem[];
  toolCallCount: number;
  editCount: number;
  lastAction: string | null;
};

const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "multiedit", "apply_patch"]);

export function deriveCodeState(dag: ParsedDag, events: readonly AgentEvent[]): CodeState {
  const accumulators = new Map<string, NodeAccumulator>();
  for (const node of dag.nodes) accumulators.set(node.id, newAccumulator());

  const sorted = [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  let usageFromEvent: { input: number; output: number; cost: number } | null = null;

  for (const event of sorted) {
    if (event.kind === "code_usage") {
      usageFromEvent = {
        input: event.inputTokens,
        output: event.outputTokens,
        cost: event.costUsd,
      };
      continue;
    }
    const target = nodeIdForEvent(event);
    if (!target) continue;
    const acc = accumulators.get(target);
    if (!acc) continue;
    applyEvent(acc, event);
  }

  const nodesById = resolveNodes(dag.nodes, accumulators);
  const waves = buildWaves(dag, nodesById);
  const metrics = buildMetrics(dag.nodes, nodesById, waves, usageFromEvent);
  const autoSelectedNodeId = pickAutoSelected(dag.nodes, nodesById);

  return { waves, nodesById, metrics, autoSelectedNodeId };
}

function newAccumulator(): NodeAccumulator {
  return {
    status: "pending",
    startedAt: null,
    endedAt: null,
    durationMs: null,
    commitSha: null,
    error: null,
    sessionId: null,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    transcript: [],
    toolCallCount: 0,
    editCount: 0,
    lastAction: null,
  };
}

// `code_node_*` events carry an explicit `nodeId`; the generic per-node events
// (message/tool/log) carry `subagent` set to the node id.
function nodeIdForEvent(event: AgentEvent): string | null {
  if (event.kind === "code_node_started" || event.kind === "code_node_ended") return event.nodeId;
  if (
    event.kind === "message_delta" ||
    event.kind === "tool_call" ||
    event.kind === "tool_result" ||
    event.kind === "log"
  ) {
    return event.subagent ?? null;
  }
  return null;
}

function applyEvent(acc: NodeAccumulator, event: AgentEvent): void {
  switch (event.kind) {
    case "code_node_started":
      acc.status = "running";
      acc.startedAt = event.ts;
      acc.sessionId = event.sessionId;
      return;
    case "code_node_ended":
      acc.status = event.status;
      acc.endedAt = event.ts;
      acc.durationMs = event.durationMs;
      acc.costUsd = event.costUsd;
      acc.inputTokens = event.inputTokens;
      acc.outputTokens = event.outputTokens;
      if (event.error !== undefined) acc.error = event.error;
      if (event.commitSha !== undefined) {
        acc.commitSha = event.commitSha;
        acc.transcript = [
          ...acc.transcript,
          { kind: "commit", id: event.id, ts: event.ts, commitSha: event.commitSha },
        ];
      }
      return;
    case "message_delta":
      acc.transcript = appendMessageDelta(acc.transcript, event);
      acc.lastAction = summarizeText(lastMessageText(acc.transcript));
      return;
    case "tool_call":
      acc.toolCallCount += 1;
      if (EDIT_TOOLS.has(event.tool.toLowerCase())) acc.editCount += 1;
      acc.lastAction = `${event.tool} ${summarizeInput(event.input)}`.trim();
      acc.transcript = [...acc.transcript, toolCallItem(event)];
      return;
    case "tool_result":
      acc.transcript = applyToolResult(acc.transcript, event);
      return;
    case "log":
      acc.transcript = [
        ...acc.transcript,
        { kind: "log", id: event.id, ts: event.ts, level: event.level, text: event.text },
      ];
      return;
    default:
      return;
  }
}

// The orchestrator streams message_delta token by token. Coalesce a run of
// consecutive deltas into a single flowing message item (any tool/log/commit
// item in between breaks the run and starts a new message), so the transcript
// reads as prose instead of one word per line.
function appendMessageDelta(
  transcript: readonly CodeTranscriptItem[],
  event: AgentEvent & { kind: "message_delta" },
): CodeTranscriptItem[] {
  const last = transcript[transcript.length - 1];
  if (last && last.kind === "message") {
    const merged: CodeTranscriptItem = { ...last, text: last.text + event.text };
    return transcript.map((item, i) => (i === transcript.length - 1 ? merged : item));
  }
  return [...transcript, { kind: "message", id: event.id, ts: event.ts, text: event.text }];
}

function lastMessageText(transcript: readonly CodeTranscriptItem[]): string {
  const last = transcript[transcript.length - 1];
  return last && last.kind === "message" ? last.text : "";
}

function toolCallItem(event: AgentEvent & { kind: "tool_call" }): CodeTranscriptItem {
  return {
    kind: "tool",
    id: event.id,
    ts: event.ts,
    callId: event.callId ?? event.id,
    tool: event.tool,
    input: event.input,
    status: "running",
  };
}

// Fold a tool_result into the matching pending tool_call by callId, marking it
// ok/error and attaching output. Orphan results (no prior call) append as a
// fresh resolved tool row.
function applyToolResult(
  transcript: readonly CodeTranscriptItem[],
  event: AgentEvent & { kind: "tool_result" },
): CodeTranscriptItem[] {
  const callId = event.callId ?? event.id;
  const idx = transcript.findIndex(
    (item) => item.kind === "tool" && item.callId === callId && item.status === "running",
  );
  const resolvedStatus = event.ok ? "ok" : "error";
  if (idx === -1) {
    return [
      ...transcript,
      {
        kind: "tool",
        id: event.id,
        ts: event.ts,
        callId,
        tool: event.tool,
        input: undefined,
        status: resolvedStatus,
        ...(event.output !== undefined ? { output: event.output } : {}),
      },
    ];
  }
  const existing = transcript[idx];
  if (!existing || existing.kind !== "tool") return [...transcript];
  const durationMs = event.ts.getTime() - existing.ts.getTime();
  const resolved: CodeTranscriptItem = {
    ...existing,
    status: resolvedStatus,
    durationMs,
    ...(event.output !== undefined ? { output: event.output } : {}),
  };
  return transcript.map((item, i) => (i === idx ? resolved : item));
}

function resolveNodes(
  nodes: readonly ParsedDagNode[],
  accumulators: ReadonlyMap<string, NodeAccumulator>,
): ReadonlyMap<string, CodeNodeView> {
  const withBlocked = applyBlockedCascade(nodes, accumulators);
  const entries = nodes.map((node): readonly [string, CodeNodeView] => {
    const acc = accumulators.get(node.id) ?? newAccumulator();
    const status = withBlocked.get(node.id) ?? acc.status;
    return [node.id, toNodeView(node, acc, status)];
  });
  return new Map(entries);
}

// A pending node becomes `blocked` when any of its (transitive) dependencies
// failed or is itself blocked. Iterate to a fixpoint so chains propagate.
function applyBlockedCascade(
  nodes: readonly ParsedDagNode[],
  accumulators: ReadonlyMap<string, NodeAccumulator>,
): ReadonlyMap<string, NodeStatus> {
  const status = new Map<string, NodeStatus>(
    nodes.map((node) => [node.id, accumulators.get(node.id)?.status ?? "pending"]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (status.get(node.id) !== "pending") continue;
      const blocked = node.dependsOn.some((dep) => {
        const depStatus = status.get(dep);
        return depStatus === "failed" || depStatus === "blocked";
      });
      if (blocked) {
        status.set(node.id, "blocked");
        changed = true;
      }
    }
  }
  return status;
}

function toNodeView(node: ParsedDagNode, acc: NodeAccumulator, status: NodeStatus): CodeNodeView {
  return {
    id: node.id,
    title: node.title,
    phase: node.phase,
    lane: node.lane,
    safety: node.safety,
    dependsOn: node.dependsOn,
    assertion: node.assertion,
    status,
    startedAt: acc.startedAt,
    endedAt: acc.endedAt,
    durationMs: acc.durationMs,
    commitSha: acc.commitSha,
    error: acc.error,
    sessionId: acc.sessionId,
    costUsd: acc.costUsd,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    transcript: acc.transcript,
    subLine: subLineFor(node, acc, status),
    toolCallCount: acc.toolCallCount,
    editCount: acc.editCount,
  };
}

function subLineFor(node: ParsedDagNode, acc: NodeAccumulator, status: NodeStatus): string {
  switch (status) {
    case "succeeded":
      return acc.commitSha ? `committed ${shortSha(acc.commitSha)}` : "no changes to commit";
    case "failed":
      return acc.error ? `error · ${truncate(acc.error, 60)}` : "failed";
    case "blocked":
      return blockedSubLine(node, acc);
    case "running":
      return acc.lastAction ?? "starting";
    case "pending":
      return node.dependsOn.length > 0 ? `waits for ${node.dependsOn.join(", ")}` : "queued";
  }
}

function blockedSubLine(node: ParsedDagNode, acc: NodeAccumulator): string {
  if (acc.error) return `blocked · ${truncate(acc.error, 60)}`;
  return node.dependsOn.length > 0 ? `blocked by ${node.dependsOn.join(", ")}` : "blocked";
}

function buildWaves(
  dag: ParsedDag,
  nodesById: ReadonlyMap<string, CodeNodeView>,
): readonly CodeWaveView[] {
  const groups =
    dag.waves.length > 0
      ? dag.waves.map((wave) => ({
          id: wave.id,
          name: wave.name,
          policy: wave.policy,
          nodeIds: wave.nodes.filter((id) => nodesById.has(id)),
        }))
      : groupNodesByPhase(dag.nodes).map((group, index) => ({
          id: `phase-${index}`,
          name: group.name,
          policy: group.policy,
          nodeIds: group.nodes.map((n) => n.id),
        }));

  return groups.map((group) => {
    const nodes = group.nodeIds
      .map((id) => nodesById.get(id))
      .filter((n): n is CodeNodeView => n !== undefined);
    return {
      id: group.id,
      name: group.name,
      policy: group.policy,
      nodes,
      state: waveState(nodes),
    };
  });
}

function waveState(nodes: readonly CodeNodeView[]): WaveState {
  if (nodes.length === 0) return "pending";
  if (nodes.every((n) => n.status === "succeeded")) return "done";
  const anyActive = nodes.some(
    (n) => n.status === "running" || n.status === "succeeded" || n.status === "failed",
  );
  return anyActive ? "running" : "pending";
}

function buildMetrics(
  nodes: readonly ParsedDagNode[],
  nodesById: ReadonlyMap<string, CodeNodeView>,
  waves: readonly CodeWaveView[],
  usageFromEvent: { input: number; output: number; cost: number } | null,
): CodeMetrics {
  const views = nodes
    .map((node) => nodesById.get(node.id))
    .filter((n): n is CodeNodeView => n !== undefined);
  const doneCount = views.filter((n) => n.status === "succeeded").length;
  const commitCount = views.filter((n) => n.commitSha !== null).length;
  const firstUnfinished = waves.findIndex((wave) => wave.state !== "done");

  const summed = views.reduce(
    (acc, n) => ({
      input: acc.input + n.inputTokens,
      output: acc.output + n.outputTokens,
      cost: acc.cost + n.costUsd,
    }),
    { input: 0, output: 0, cost: 0 },
  );
  const usage = usageFromEvent ?? summed;

  return {
    waveCurrent: firstUnfinished === -1 ? waves.length : firstUnfinished + 1,
    waveTotal: waves.length,
    doneCount,
    totalCount: nodes.length,
    commitCount,
    totalInputTokens: usage.input,
    totalOutputTokens: usage.output,
    totalCostUsd: usage.cost,
  };
}

// Default selection: the running node the user most likely wants to watch; then
// the next runnable node; then the most recently finished one.
function pickAutoSelected(
  nodes: readonly ParsedDagNode[],
  nodesById: ReadonlyMap<string, CodeNodeView>,
): string | null {
  const views = nodes
    .map((node) => nodesById.get(node.id))
    .filter((n): n is CodeNodeView => n !== undefined);
  const running = views.find((n) => n.status === "running");
  if (running) return running.id;
  const pending = views.find((n) => n.status === "pending");
  if (pending) return pending.id;
  const ended = [...views]
    .filter((n) => n.endedAt !== null)
    .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))[0];
  return ended?.id ?? views[0]?.id ?? null;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function summarizeText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return truncate(collapsed, 80);
}

function summarizeInput(input: unknown): string {
  if (typeof input === "string") return truncate(input, 60);
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const candidate = record["path"] ?? record["command"] ?? record["query"] ?? record["file_path"];
    if (typeof candidate === "string") return truncate(candidate, 60);
  }
  return "";
}
