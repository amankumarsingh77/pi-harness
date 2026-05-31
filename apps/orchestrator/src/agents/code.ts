import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import simpleGit from "simple-git";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import {
  ExecutionDagSchema,
  type AgentEvent,
  type ExecutionDag,
  type ExecutionDagNode,
  type PhaseModelConfig,
} from "@pi-harness/shared";
import { getSubagent } from "@pi-harness/subagents";
import type { EventStore } from "../adapters/event-store.js";
import { mkEvent } from "../domain/events.js";
import type { ArtifactsStore } from "./artifacts-store.js";

export type CreateAgentSessionFn = (opts: AgentSessionOptions) => Promise<AgentSession>;

export type CodeOpts = {
  taskId: string;
  runId: string;
  cwd: string;
  store: ArtifactsStore;
  eventStore: EventStore;
  phaseModel: PhaseModelConfig;
  createAgentSession: CreateAgentSessionFn;
  ticketTitle?: string;
  ticketDescription?: string;
  signal?: AbortSignal;
};

export type CodeResult = {
  ok: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  cancelled?: boolean;
};

type CodeNodeStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";

type CodeNodeState = {
  status: CodeNodeStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  commitSha?: string;
};

type CodeStateFile = {
  version: 1;
  nodes: Record<string, CodeNodeState>;
};

type Usage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

type NodeRunResult = Usage & {
  nodeId: string;
  ok: boolean;
  status: "succeeded" | "failed" | "blocked";
  durationMs: number;
  error?: string;
  commitSha?: string;
};

const zeroUsage: Usage = { costUsd: 0, inputTokens: 0, outputTokens: 0 };

export async function runCode(opts: CodeOpts): Promise<CodeResult> {
  const artifact = await opts.store.readArtifact(opts.cwd, opts.taskId, "execution-dag");
  if (!artifact) {
    return { ...zeroUsage, ok: false, error: "execution-dag.yaml not found" };
  }

  const parsed = parseExecutionDag(artifact.body);
  if (!parsed.ok) {
    return { ...zeroUsage, ok: false, error: `execution-dag.yaml: ${parsed.error}` };
  }

  await mkdir(join(opts.cwd, ".harness", opts.taskId), { recursive: true });
  let state = await loadCodeState(opts.cwd, opts.taskId, parsed.dag);
  let total = { ...zeroUsage };

  while (true) {
    if (opts.signal?.aborted) {
      return { ...total, ok: false, cancelled: true, error: "code phase cancelled" };
    }

    const terminal = summarizeState(parsed.dag, state);
    if (terminal.kind === "succeeded") {
      await publishUsage(opts, total);
      return { ...total, ok: true };
    }
    if (terminal.kind === "failed") {
      await publishUsage(opts, total);
      return { ...total, ok: false, error: terminal.error };
    }

    const runnable = runnableNodes(parsed.dag, state);
    if (runnable.length === 0) {
      state = blockUnreachable(parsed.dag, state, "dependency failed or no runnable node remains");
      await saveCodeState(opts.cwd, opts.taskId, state);
      await publishUsage(opts, total);
      return { ...total, ok: false, error: "code phase stalled with pending nodes" };
    }

    const batch = selectRunnableBatch(runnable);
    const sessionResults = await Promise.all(batch.map((node) => runOneNode({ opts, dag: parsed.dag, node, state })));
    const results: NodeRunResult[] = [];
    for (const result of sessionResults) {
      if (!result.ok) {
        results.push(result);
        continue;
      }
      try {
        const commitSha = await commitNodeChanges(opts.cwd, nodeById(parsed.dag, result.nodeId));
        results.push({ ...result, ...(commitSha ? { commitSha } : {}) });
      } catch (err) {
        results.push({
          ...result,
          ok: false,
          status: "failed",
          error: `commit failed: ${(err as Error).message}`,
        });
      }
    }

    for (const result of results) {
      total = addUsage(total, result);
      state = setNodeState(state, result.nodeId, {
        status: result.status,
        endedAt: new Date().toISOString(),
        ...(result.error !== undefined ? { error: result.error } : {}),
        ...(result.commitSha !== undefined ? { commitSha: result.commitSha } : {}),
      });
      await publishNodeEnded(opts, result);
    }

    const failed = results.find((result) => !result.ok);
    if (failed) {
      const beforeBlock = state;
      state = blockDownstream(parsed.dag, state, failed.nodeId, `blocked by failed node ${failed.nodeId}`);
      const blockedResults = blockedNodeResults(parsed.dag, beforeBlock, state);
      for (const blocked of blockedResults) {
        await publishNodeEnded(opts, blocked);
      }
      await saveCodeState(opts.cwd, opts.taskId, state);
      await publishUsage(opts, total);
      return { ...total, ok: false, error: failed.error ?? `${failed.nodeId} failed` };
    }

    await saveCodeState(opts.cwd, opts.taskId, state);
  }
}

function parseExecutionDag(body: string): { ok: true; dag: ExecutionDag } | { ok: false; error: string } {
  let loaded: unknown;
  try {
    loaded = yaml.load(body);
  } catch (err) {
    return { ok: false, error: `YAML parse error: ${(err as Error).message}` };
  }

  const result = ExecutionDagSchema.safeParse(loaded);
  if (result.success) return { ok: true, dag: result.data };

  const first = result.error.issues[0];
  if (!first) return { ok: false, error: "schema validation failed" };
  const path = first.path.length > 0 ? first.path.join(".") : "(root)";
  return { ok: false, error: `${path}: ${first.message}` };
}

async function loadCodeState(cwd: string, taskId: string, dag: ExecutionDag): Promise<CodeStateFile> {
  const path = codeStatePath(cwd, taskId);
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, "utf8");
      return normalizeState(JSON.parse(raw), dag);
    } catch {
      return initialState(dag);
    }
  }
  return initialState(dag);
}

function normalizeState(raw: unknown, dag: ExecutionDag): CodeStateFile {
  if (!isRecord(raw)) return initialState(dag);
  if (raw.version !== 1 || !isRecord(raw.nodes)) return initialState(dag);

  return {
    version: 1,
    nodes: Object.fromEntries(
      dag.nodes.map((node) => {
        const nodes = raw.nodes as Record<string, unknown>;
        const cur = nodes[node.id];
        const state = isRecord(cur) && isCodeNodeStatus(cur.status)
          ? fromRawNodeState(cur, cur.status)
          : { status: "pending" as const };
        return [node.id, state];
      }),
    ),
  };
}

function fromRawNodeState(raw: Record<string, unknown>, status: CodeNodeStatus): CodeNodeState {
  if (status === "running") {
    return { status: "pending" };
  }
  return {
    status,
    ...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.endedAt === "string" ? { endedAt: raw.endedAt } : {}),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    ...(typeof raw.commitSha === "string" ? { commitSha: raw.commitSha } : {}),
  };
}

function initialState(dag: ExecutionDag): CodeStateFile {
  return {
    version: 1,
    nodes: Object.fromEntries(dag.nodes.map((node) => [node.id, { status: "pending" }])),
  };
}

async function saveCodeState(cwd: string, taskId: string, state: CodeStateFile): Promise<void> {
  await writeFile(codeStatePath(cwd, taskId), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function codeStatePath(cwd: string, taskId: string): string {
  return join(cwd, ".harness", taskId, "code-state.json");
}

function summarizeState(
  dag: ExecutionDag,
  state: CodeStateFile,
): { kind: "active" } | { kind: "succeeded" } | { kind: "failed"; error: string } {
  const statuses = dag.nodes.map((node) => state.nodes[node.id]?.status ?? "pending");
  if (statuses.every((status) => status === "succeeded")) return { kind: "succeeded" };
  const failed = dag.nodes.find((node) => state.nodes[node.id]?.status === "failed");
  if (failed) {
    const error = state.nodes[failed.id]?.error ?? `${failed.id} failed`;
    return { kind: "failed", error };
  }
  const blocked = dag.nodes.find((node) => state.nodes[node.id]?.status === "blocked");
  if (blocked && statuses.every((status) => status === "succeeded" || status === "blocked")) {
    const error = state.nodes[blocked.id]?.error ?? `${blocked.id} blocked`;
    return { kind: "failed", error };
  }
  return { kind: "active" };
}

function runnableNodes(dag: ExecutionDag, state: CodeStateFile): ExecutionDagNode[] {
  return dag.nodes.filter((node) => {
    if ((state.nodes[node.id]?.status ?? "pending") !== "pending") return false;
    return node.dependsOn.every((dep) => state.nodes[dep]?.status === "succeeded");
  });
}

function selectRunnableBatch(runnable: readonly ExecutionDagNode[]): ExecutionDagNode[] {
  const firstExclusive = runnable.find((node) => node.safety === "exclusive");
  if (firstExclusive) return [firstExclusive];
  return [...runnable];
}

async function runOneNode(args: {
  opts: CodeOpts;
  dag: ExecutionDag;
  node: ExecutionDagNode;
  state: CodeStateFile;
}): Promise<NodeRunResult> {
  const { opts, dag, node } = args;
  const startedAt = Date.now();
  const sessionId = `${node.id}-${crypto.randomUUID()}`;
  args.state = setNodeState(args.state, node.id, {
    status: "running",
    startedAt: new Date(startedAt).toISOString(),
  });
  await saveCodeState(opts.cwd, opts.taskId, args.state);
  await opts.eventStore.append(mkEvent({
    runId: opts.runId,
    taskId: opts.taskId,
    kind: "code_node_started",
    nodeId: node.id,
    title: node.title,
    phaseName: node.phase,
    lane: node.lane,
    safety: node.safety,
    sessionId,
  }));

  let transcript = "";
  let session: AgentSession | null = null;
  const onAbort = (): void => {
    void session?.abort().catch(() => {});
  };

  try {
    const def = getSubagent("code");
    const systemPrompt = readFileSync(def.promptPath, "utf8");
    await mkdir(join(opts.cwd, ".harness", opts.taskId, "code-sessions"), { recursive: true });
    session = await opts.createAgentSession({
      cwd: opts.cwd,
      model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
      ...(opts.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: opts.phaseModel.thinkingLevel }
        : {}),
      systemPrompt,
      sessionPath: join(opts.cwd, ".harness", opts.taskId, "code-sessions", `${node.id}.jsonl`),
      tools: [...def.allowedTools],
      onEvent: (event) => {
        if (event.kind === "message_delta") transcript += event.text;
        forwardCodeBridgeEvent(opts, node.id, event);
      },
    });

    if (opts.signal?.aborted) {
      await session.abort().catch(() => {});
      return failedNodeResult(node.id, startedAt, "code node aborted");
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const usage = await session.prompt(buildCoderPrompt({ opts, dag, node }));
    if (transcript.includes("<coder-blocked")) {
      return { ...usage, nodeId: node.id, ok: false, status: "failed", durationMs: Date.now() - startedAt, error: "coder blocked" };
    }

    return {
      ...usage,
      nodeId: node.id,
      ok: true,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = err instanceof AuthError
      ? `missing API key for ${opts.phaseModel.provider}`
      : (err as Error).message;
    return failedNodeResult(node.id, startedAt, message);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await session?.close().catch(() => {});
  }
}

function buildCoderPrompt(args: {
  opts: CodeOpts;
  dag: ExecutionDag;
  node: ExecutionDagNode;
}): string {
  const { opts, dag, node } = args;
  const dependencies = node.dependsOn
    .map((id) => dag.nodes.find((candidate) => candidate.id === id))
    .filter((dep): dep is ExecutionDagNode => dep !== undefined)
    .map((dep) => ({ id: dep.id, title: dep.title, assertion: dep.assertion, writes: dep.writes }));

  return [
    `You are executing one code DAG node for task ${opts.taskId}.`,
    opts.ticketTitle ? `Ticket title: ${opts.ticketTitle}` : "",
    opts.ticketDescription ? `Ticket description:\n${opts.ticketDescription}` : "",
    "",
    "# Assigned DAG node",
    "",
    JSON.stringify(node, null, 2),
    "",
    "# Completed dependency context",
    "",
    JSON.stringify(dependencies, null, 2),
    "",
    "# Required discipline",
    "",
    `- You may write only these paths: ${node.writes.join(", ")}.`,
    "- Do not stage, commit, push, branch, or alter git history.",
    "- If the write set is insufficient, emit the blocked marker and stop.",
    "- Finish by emitting the required completion marker from the system prompt.",
  ].filter((line) => line.length > 0).join("\n");
}

async function commitNodeChanges(cwd: string, node: ExecutionDagNode): Promise<string | null> {
  const git = simpleGit(cwd);
  await git.raw(["add", "--", ...node.writes]);
  const staged = (await git.diff(["--cached", "--name-only"])).trim();
  if (staged.length === 0) return null;
  const result = await git.commit(`feat(code): complete ${node.id}`);
  return result.commit || null;
}

function nodeById(dag: ExecutionDag, nodeId: string): ExecutionDagNode {
  const node = dag.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`unknown node ${nodeId}`);
  return node;
}

function forwardCodeBridgeEvent(opts: CodeOpts, nodeId: string, event: PiBridgeEvent): void {
  if (event.kind === "turn_end" || event.kind === "error") return;
  const base = { runId: opts.runId, taskId: opts.taskId, subagent: nodeId };
  let next: AgentEvent | null = null;
  if (event.kind === "message_delta") {
    next = mkEvent({ ...base, kind: "message_delta", text: event.text });
  } else if (event.kind === "tool_call") {
    next = mkEvent({ ...base, kind: "tool_call", callId: event.callId, tool: event.tool, input: event.input });
  } else if (event.kind === "tool_result") {
    next = mkEvent({
      ...base,
      kind: "tool_result",
      callId: event.callId,
      tool: event.tool,
      ok: event.ok,
      ...(event.output !== undefined ? { output: event.output } : {}),
    });
  } else if (event.kind === "log") {
    next = mkEvent({ ...base, kind: "log", level: event.level, text: event.text });
  }
  if (next) void opts.eventStore.append(next).catch(() => {});
}

function failedNodeResult(nodeId: string, startedAt: number, error: string): NodeRunResult {
  return {
    ...zeroUsage,
    nodeId,
    ok: false,
    status: "failed",
    durationMs: Date.now() - startedAt,
    error,
  };
}

function blockDownstream(
  dag: ExecutionDag,
  state: CodeStateFile,
  failedNodeId: string,
  error: string,
): CodeStateFile {
  const blockedIds = downstreamIds(dag, failedNodeId);
  return {
    version: 1,
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([nodeId, cur]) => [
        nodeId,
        blockedIds.has(nodeId) && cur.status === "pending"
          ? { status: "blocked", endedAt: new Date().toISOString(), error }
          : cur,
      ]),
    ),
  };
}

function blockedNodeResults(
  dag: ExecutionDag,
  previous: CodeStateFile,
  next: CodeStateFile,
): NodeRunResult[] {
  return dag.nodes
    .filter((node) => previous.nodes[node.id]?.status === "pending" && next.nodes[node.id]?.status === "blocked")
    .map((node) => ({
      ...zeroUsage,
      nodeId: node.id,
      ok: false,
      status: "blocked",
      durationMs: 0,
      error: next.nodes[node.id]?.error ?? `${node.id} blocked`,
    }));
}

function blockUnreachable(dag: ExecutionDag, state: CodeStateFile, error: string): CodeStateFile {
  return {
    version: 1,
    nodes: Object.fromEntries(
      dag.nodes.map((node) => {
        const cur = state.nodes[node.id] ?? { status: "pending" as const };
        return [
          node.id,
          cur.status === "pending"
            ? { status: "blocked", endedAt: new Date().toISOString(), error }
            : cur,
        ];
      }),
    ),
  };
}

function downstreamIds(dag: ExecutionDag, nodeId: string): Set<string> {
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of dag.nodes) {
      if (out.has(node.id)) continue;
      if (node.dependsOn.includes(nodeId) || node.dependsOn.some((dep) => out.has(dep))) {
        out.add(node.id);
        changed = true;
      }
    }
  }
  return out;
}

function setNodeState(
  state: CodeStateFile,
  nodeId: string,
  patch: Partial<CodeNodeState>,
): CodeStateFile {
  const current = state.nodes[nodeId] ?? { status: "pending" as const };
  return {
    version: 1,
    nodes: {
      ...state.nodes,
      [nodeId]: {
        ...current,
        ...patch,
      },
    },
  };
}

async function publishNodeEnded(opts: CodeOpts, result: NodeRunResult): Promise<void> {
  await opts.eventStore.append(mkEvent({
    runId: opts.runId,
    taskId: opts.taskId,
    kind: "code_node_ended",
    nodeId: result.nodeId,
    ok: result.ok,
    status: result.status,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    ...(result.commitSha !== undefined ? { commitSha: result.commitSha } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  }));
}

async function publishUsage(opts: CodeOpts, usage: Usage): Promise<void> {
  await opts.eventStore.append(mkEvent({
    runId: opts.runId,
    taskId: opts.taskId,
    kind: "code_usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
  }));
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    costUsd: a.costUsd + b.costUsd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodeNodeStatus(value: unknown): value is CodeNodeStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "blocked"
  );
}
