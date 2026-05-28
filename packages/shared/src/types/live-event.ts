import type { AgentEvent } from "./event.js";
import type { Claim, ClaimEvent, MissionEvent, MissionPacket } from "./mission.js";
import type { Run } from "./run.js";
import type { DashboardSummary, Task, TaskStatus } from "./task.js";

export type LiveEventScope = "dashboard" | "task" | "run";

export type DashboardSnapshotPayload = {
  readonly tasks: readonly Task[];
  readonly counts: Record<TaskStatus, number>;
  readonly runs: readonly Run[];
  readonly summary: DashboardSummary;
  readonly humanInterventionTaskIds: readonly string[];
};

export type ArtifactUpdatedPayload = {
  readonly taskId: string;
  readonly runId: string;
  readonly artifact: string;
  readonly sourceEventId: string;
};

export type GateUpdatedPayload = {
  readonly taskId: string;
  readonly runId: string;
  readonly sourceEventId: string;
  readonly sourceKind: AgentEvent["kind"];
};

export type UsageUpdatedPayload = {
  readonly taskId: string;
  readonly runId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly cumulativeInputTokens?: number;
  readonly cumulativeOutputTokens?: number;
  readonly cumulativeCostUsd?: number;
  readonly sourceEventId: string;
};

export type MissionUpdatedPayload = {
  readonly mission: MissionPacket;
  readonly event: MissionEvent | null;
};

export type ClaimsUpdatedPayload = {
  readonly taskId: string;
  readonly claims: readonly Claim[];
  readonly claimEvents: readonly ClaimEvent[];
};

export type GraphifyInstallReason =
  | "missing_cli"
  | "incompatible_cli"
  | "stale_skill"
  | "missing_python_extra"
  | "missing_provider_key";

export type GraphifyInstallStatus = "ready" | "installing" | "install_failed" | "config_required";

export type GraphifyInstallState = {
  readonly status: GraphifyInstallStatus;
  readonly updatedAt: Date;
  readonly reason?: GraphifyInstallReason;
  readonly message?: string;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
};

export type LiveEventPayloadByKind = {
  readonly "dashboard.snapshot": DashboardSnapshotPayload;
  readonly "task.updated": Task;
  readonly "run.updated": Run;
  readonly "agent.event.appended": AgentEvent;
  readonly "artifact.updated": ArtifactUpdatedPayload;
  readonly "gate.updated": GateUpdatedPayload;
  readonly "usage.updated": UsageUpdatedPayload;
  readonly "mission.updated": MissionUpdatedPayload;
  readonly "claims.updated": ClaimsUpdatedPayload;
  readonly "graphify.status.updated": GraphifyInstallState;
};

export type LiveEventKind = keyof LiveEventPayloadByKind;

export type LiveEventEnvelope<K extends LiveEventKind = LiveEventKind> = {
  readonly id: string;
  readonly sequence: number;
  readonly ts: Date;
  readonly scope: LiveEventScope;
  readonly taskId?: string;
  readonly runId?: string;
  readonly kind: K;
  readonly payload: LiveEventPayloadByKind[K];
};
