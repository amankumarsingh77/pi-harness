export type PlanAgentNodeStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "skipped"
  | "artifact";

export type PlanAgentGraphNodeKind = "planner" | "agent" | "synthesis" | "artifact";

export type PlanAgentGraphNode = {
  readonly id: string;
  readonly kind: PlanAgentGraphNodeKind;
  readonly title: string;
  readonly role: string;
  readonly lane: string;
  readonly status: PlanAgentNodeStatus;
  readonly parentId: string | null;
  readonly sessionId: string | null;
  readonly model: string | null;
  readonly tools: readonly string[];
  readonly artifactPath: string | null;
  readonly dependsOn: readonly string[];
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly error: string | null;
};

export type PlanAgentGraphEdgeKind = "spawn" | "depends_on" | "artifact";

export type PlanAgentGraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: PlanAgentGraphEdgeKind;
};

export type PlanAgentGraphTotals = {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type PlanAgentGraph = {
  readonly nodes: readonly PlanAgentGraphNode[];
  readonly edges: readonly PlanAgentGraphEdge[];
  readonly totals: PlanAgentGraphTotals;
};
