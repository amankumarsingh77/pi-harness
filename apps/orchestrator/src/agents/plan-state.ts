import type { Artifact } from "@pi-harness/shared";

export type PlanJsonlEvent = Record<string, unknown> & {
  readonly kind?: string;
  readonly ts?: string;
};

export type PlanArtifactsSnapshot = {
  readonly plan: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly blastRadius: Artifact | null;
};

export type PlannerDecision =
  | { readonly kind: "initial" }
  | { readonly kind: "revision"; readonly comment: string }
  | { readonly kind: "recovery"; readonly attempt: number; readonly reason: string }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "ready" };

export type PlanExecutionState = {
  readonly artifactsReady: boolean;
  readonly recoveryAttempts: number;
  readonly plannerDecision: PlannerDecision;
};

export function derivePlanExecutionState(input: {
  readonly events: readonly PlanJsonlEvent[];
  readonly artifacts: PlanArtifactsSnapshot;
  readonly recoveryCap: number;
}): PlanExecutionState {
  const artifactsReady = areArtifactsReady(input.artifacts);
  if (artifactsReady) {
    return {
      artifactsReady,
      recoveryAttempts: 0,
      plannerDecision: { kind: "ready" },
    };
  }

  const lastReadyIdx = lastIndexWhere(input.events, isReadyEvent);
  const lastRevisionIdx = lastIndexWhere(input.events, isRevisionEvent);
  const cycleStartIdx = Math.max(lastReadyIdx, lastRevisionIdx);
  const cycleEvents = input.events.slice(cycleStartIdx + 1);
  const hasNewRevision = lastRevisionIdx !== -1 && lastRevisionIdx > lastReadyIdx;

  if (hasNewRevision && !cycleEvents.some(isPlannerStarted)) {
    return {
      artifactsReady,
      recoveryAttempts: 0,
      plannerDecision: {
        kind: "revision",
        comment: stringField(input.events[lastRevisionIdx], "comment") ?? "",
      },
    };
  }

  const recoveryAttempts = countRecoveryStarts(cycleEvents);
  const hasPlannerStarted = cycleEvents.some(isPlannerStarted);
  if (!hasPlannerStarted) {
    return {
      artifactsReady,
      recoveryAttempts,
      plannerDecision: { kind: "initial" },
    };
  }

  if (recoveryAttempts >= input.recoveryCap) {
    return {
      artifactsReady,
      recoveryAttempts,
      plannerDecision: {
        kind: "blocked",
        reason: `planner recovery exhausted after ${input.recoveryCap} attempts`,
      },
    };
  }

  return {
    artifactsReady,
    recoveryAttempts,
    plannerDecision: {
      kind: "recovery",
      attempt: recoveryAttempts + 1,
      reason: latestPlannerCompletion(cycleEvents) === null
        ? "planner started but did not complete"
        : "planner completed without ready artifacts",
    },
  };
}

function areArtifactsReady(artifacts: PlanArtifactsSnapshot): boolean {
  return (
    artifacts.plan?.fm.status === "ready" &&
    artifacts.scenarios?.fm.status === "ready" &&
    artifacts.blastRadius?.fm.status === "ready"
  );
}

function isReadyEvent(event: PlanJsonlEvent): boolean {
  if (event.kind !== "plan_system") return false;
  if (event["systemKind"] !== "status_changed") return false;
  const data = event["data"];
  return isRecord(data) && data["status"] === "ready";
}

function isRevisionEvent(event: PlanJsonlEvent): boolean {
  return event.kind === "plan_revision_requested";
}

function isPlannerStarted(event: PlanJsonlEvent): boolean {
  return event.kind === "plan_system" && event["systemKind"] === "planner_started";
}

function latestPlannerCompletion(events: readonly PlanJsonlEvent[]): PlanJsonlEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.kind === "plan_system" && event["systemKind"] === "planner_turn_completed") {
      return event;
    }
  }
  return null;
}

function countRecoveryStarts(events: readonly PlanJsonlEvent[]): number {
  return events.filter((event) => {
    if (!isPlannerStarted(event)) return false;
    const data = event["data"];
    return isRecord(data) && data["mode"] === "recovery";
  }).length;
}

function lastIndexWhere(
  events: readonly PlanJsonlEvent[],
  pred: (event: PlanJsonlEvent) => boolean,
): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (pred(events[i]!)) return i;
  }
  return -1;
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
