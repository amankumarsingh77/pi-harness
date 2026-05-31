import type { AgentEvent } from "@pi-harness/shared";

export const CODE_DAG_BODY = `version: 1
nodes:
  - id: C-1
    title: Add code-state types
    phase: Scaffolding
    kind: types
    lane: core
    safety: parallel-safe
    dependsOn: []
    assertion: The CodeNodeState type compiles and is exported.
  - id: C-2
    title: Execution DAG schema
    phase: Scaffolding
    kind: schema
    lane: core
    safety: parallel-safe
    dependsOn: []
    assertion: ExecutionDagSchema validates a sample DAG.
  - id: C-5
    title: runCode node loop
    phase: Runner
    kind: runner
    lane: runner
    safety: exclusive
    dependsOn: [C-1, C-2]
    assertion: runCode drives the DAG to terminal.
waves:
  - id: W-1
    name: Scaffolding
    policy: parallel
    nodes: [C-1, C-2]
  - id: W-2
    name: Runner
    policy: sequential
    nodes: [C-5]
`;

const RUN_ID = "run-code-1";
const TASK_ID = "task-1";
const BASE = new Date("2026-05-31T12:00:00Z").getTime();

export const at = (secondsFromBase: number): Date => new Date(BASE + secondsFromBase * 1000);

let seq = 0;
export function resetEventSeq(): void {
  seq = 0;
}

function base(ts: Date): { id: string; runId: string; taskId: string; ts: Date } {
  seq += 1;
  return { id: `e${seq}`, runId: RUN_ID, taskId: TASK_ID, ts };
}

export const nodeStarted = (nodeId: string, ts: Date): AgentEvent => ({
  ...base(ts),
  kind: "code_node_started",
  nodeId,
  title: nodeId,
  phaseName: "phase",
  lane: "lane",
  safety: "parallel-safe",
  sessionId: `${nodeId}-sess`,
});

export const nodeEnded = (
  nodeId: string,
  status: "succeeded" | "failed" | "blocked",
  ts: Date,
  extra: { commitSha?: string; error?: string; durationMs?: number; costUsd?: number } = {},
): AgentEvent => ({
  ...base(ts),
  kind: "code_node_ended",
  nodeId,
  ok: status === "succeeded",
  status,
  durationMs: extra.durationMs ?? 2000,
  costUsd: extra.costUsd ?? 0.05,
  inputTokens: 1000,
  outputTokens: 200,
  ...(extra.commitSha !== undefined ? { commitSha: extra.commitSha } : {}),
  ...(extra.error !== undefined ? { error: extra.error } : {}),
});

export const message = (nodeId: string, text: string, ts: Date): AgentEvent => ({
  ...base(ts),
  kind: "message_delta",
  text,
  subagent: nodeId,
});

export const toolCall = (
  nodeId: string,
  callId: string,
  tool: string,
  input: unknown,
  ts: Date,
): AgentEvent => ({ ...base(ts), kind: "tool_call", callId, tool, input, subagent: nodeId });

export const toolResult = (
  nodeId: string,
  callId: string,
  tool: string,
  ok: boolean,
  ts: Date,
  output?: unknown,
): AgentEvent => ({
  ...base(ts),
  kind: "tool_result",
  callId,
  tool,
  ok,
  subagent: nodeId,
  ...(output !== undefined ? { output } : {}),
});

export const usage = (input: number, output: number, cost: number, ts: Date): AgentEvent => ({
  ...base(ts),
  kind: "code_usage",
  inputTokens: input,
  outputTokens: output,
  costUsd: cost,
});
