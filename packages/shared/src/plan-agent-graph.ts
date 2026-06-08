import type {
  PlanAgentGraph,
  PlanAgentGraphEdge,
  PlanAgentGraphNode,
  PlanAgentNodeStatus,
} from "./types/plan-graph.js";

type DerivePlanAgentGraphInput = {
  readonly events: readonly unknown[];
  readonly artifactNames: readonly string[];
};

type NodePatch = Pick<PlanAgentGraphNode, "id" | "title" | "role" | "lane"> &
  Partial<Omit<PlanAgentGraphNode, "id" | "title" | "role" | "lane">>;

const PLANNER_NODE: PlanAgentGraphNode = {
  id: "planner",
  kind: "planner",
  title: "Planner Orchestrator",
  role: "planner",
  lane: "control",
  status: "running",
  parentId: null,
  sessionId: null,
  model: null,
  tools: [],
  artifactPath: null,
  dependsOn: [],
  startedAt: null,
  endedAt: null,
  durationMs: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  error: null,
};

export function derivePlanAgentGraph(input: DerivePlanAgentGraphInput): PlanAgentGraph {
  const nodes = new Map<string, PlanAgentGraphNode>([["planner", PLANNER_NODE]]);
  const edgeMap = new Map<string, PlanAgentGraphEdge>();

  for (const event of input.events) {
    if (!isRecord(event)) continue;
    applyEvent(nodes, edgeMap, event);
  }

  for (const artifactName of input.artifactNames) {
    const id = `artifact:${artifactName}`;
    nodes.set(id, {
      ...PLANNER_NODE,
      id,
      kind: "artifact",
      title: artifactName,
      role: "artifact",
      lane: "files",
      status: "artifact",
      parentId: "planner",
    });
    addEdge(edgeMap, "planner", id, "artifact");
  }

  const nodeList = [...nodes.values()];
  return {
    nodes: nodeList,
    edges: [...edgeMap.values()],
    totals: latestUsageTotals(input.events) ?? sumNodeUsage(nodeList),
  };
}

function applyEvent(
  nodes: Map<string, PlanAgentGraphNode>,
  edgeMap: Map<string, PlanAgentGraphEdge>,
  event: Record<string, unknown>,
): void {
  if (event["kind"] === "plan_agent_node_started") {
    const nodeId = stringField(event, "nodeId");
    if (!nodeId) return;
    const parentId = stringField(event, "parentId") ?? null;
    const dependsOn = stringArrayField(event, "dependsOn");
    nodes.set(nodeId, mergeNode(nodes.get(nodeId), {
      id: nodeId,
      kind: "agent",
      title: stringField(event, "title") ?? nodeId,
      role: stringField(event, "role") ?? nodeId,
      lane: stringField(event, "lane") ?? "research",
      status: "running",
      parentId,
      sessionId: stringField(event, "sessionId"),
      model: stringField(event, "model"),
      tools: stringArrayField(event, "tools"),
      artifactPath: stringField(event, "artifactPath"),
      dependsOn,
      startedAt: stringField(event, "ts"),
    }));
    if (parentId) addEdge(edgeMap, parentId, nodeId, "spawn");
    for (const dependency of dependsOn) addEdge(edgeMap, dependency, nodeId, "depends_on");
    return;
  }

  if (event["kind"] === "plan_agent_node_usage") {
    const nodeId = stringField(event, "nodeId");
    if (!nodeId) return;
    nodes.set(nodeId, mergeNode(nodes.get(nodeId), {
      id: nodeId,
      title: nodeId,
      role: nodeId,
      lane: "research",
      costUsd: numberField(event, "costUsd"),
      inputTokens: numberField(event, "inputTokens"),
      outputTokens: numberField(event, "outputTokens"),
    }));
    return;
  }

  if (event["kind"] === "plan_agent_node_ended") {
    const nodeId = stringField(event, "nodeId");
    if (!nodeId) return;
    nodes.set(nodeId, mergeNode(nodes.get(nodeId), {
      id: nodeId,
      title: nodeId,
      role: nodeId,
      lane: "research",
      status: nodeStatus(event),
      endedAt: stringField(event, "ts"),
      durationMs: numberField(event, "durationMs"),
      costUsd: numberField(event, "costUsd"),
      inputTokens: numberField(event, "inputTokens"),
      outputTokens: numberField(event, "outputTokens"),
      error: stringField(event, "error"),
    }));
    return;
  }

  applyLegacySubagentEvent(nodes, edgeMap, event);
}

function applyLegacySubagentEvent(
  nodes: Map<string, PlanAgentGraphNode>,
  edgeMap: Map<string, PlanAgentGraphEdge>,
  event: Record<string, unknown>,
): void {
  if (event["kind"] === "plan_subagent_started") {
    const subagent = stringField(event, "subagent");
    if (!subagent) return;
    nodes.set(subagent, mergeNode(nodes.get(subagent), {
      id: subagent,
      kind: "agent",
      title: subagent,
      role: subagent,
      lane: "preflight",
      status: "running",
      parentId: "planner",
      sessionId: stringField(event, "sessionId"),
      model: null,
      tools: [],
      artifactPath: `.harness/research/${subagent}.md`,
      dependsOn: ["planner"],
      startedAt: stringField(event, "ts"),
    }));
    addEdge(edgeMap, "planner", subagent, "spawn");
    return;
  }

  if (event["kind"] === "plan_subagent_ended") {
    const subagent = stringField(event, "subagent");
    if (!subagent) return;
    nodes.set(subagent, mergeNode(nodes.get(subagent), {
      id: subagent,
      title: subagent,
      role: subagent,
      lane: "preflight",
      status: booleanField(event, "ok") ? "succeeded" : "blocked",
      endedAt: stringField(event, "ts"),
      durationMs: numberField(event, "durationMs"),
      costUsd: numberField(event, "costUsd"),
      inputTokens: numberField(event, "inputTokens"),
      outputTokens: numberField(event, "outputTokens"),
      error: stringField(event, "error"),
    }));
  }
}

function mergeNode(existing: PlanAgentGraphNode | undefined, patch: NodePatch): PlanAgentGraphNode {
  const base = existing ?? {
    ...PLANNER_NODE,
    id: patch.id,
    kind: patch.kind ?? "agent",
    title: patch.title,
    role: patch.role,
    lane: patch.lane,
    status: patch.status ?? "queued",
  };
  return {
    ...base,
    ...patch,
    kind: patch.kind ?? base.kind,
    status: patch.status ?? base.status,
    parentId: patch.parentId ?? base.parentId,
    sessionId: patch.sessionId ?? base.sessionId,
    model: patch.model ?? base.model,
    artifactPath: patch.artifactPath ?? base.artifactPath,
    startedAt: patch.startedAt ?? base.startedAt,
    endedAt: patch.endedAt ?? base.endedAt,
    error: patch.error ?? base.error,
  };
}

function addEdge(
  edges: Map<string, PlanAgentGraphEdge>,
  source: string,
  target: string,
  kind: PlanAgentGraphEdge["kind"],
): void {
  const id = `${source}->${target}:${kind}`;
  edges.set(id, { id, source, target, kind });
}

function nodeStatus(event: Record<string, unknown>): PlanAgentNodeStatus {
  const raw = stringField(event, "status");
  if (
    raw === "succeeded" ||
    raw === "failed" ||
    raw === "blocked" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return booleanField(event, "ok") ? "succeeded" : "blocked";
}

function latestUsageTotals(events: readonly unknown[]): PlanAgentGraph["totals"] | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!isRecord(event) || event["kind"] !== "plan_usage") continue;
    return {
      costUsd: numberField(event, "cumulativeCostUsd"),
      inputTokens: numberField(event, "cumulativeInputTokens"),
      outputTokens: numberField(event, "cumulativeOutputTokens"),
    };
  }
  return null;
}

function sumNodeUsage(nodes: readonly PlanAgentGraphNode[]): PlanAgentGraph["totals"] {
  return nodes.reduce(
    (totals, node) => ({
      costUsd: totals.costUsd + node.costUsd,
      inputTokens: totals.inputTokens + node.inputTokens,
      outputTokens: totals.outputTokens + node.outputTokens,
    }),
    { costUsd: 0, inputTokens: 0, outputTokens: 0 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function stringArrayField(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
