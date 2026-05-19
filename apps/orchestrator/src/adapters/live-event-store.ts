import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { liveEvents as liveEventsTable, type DbClient } from "@pi-harness/db";
import type {
  AgentEvent,
  ArtifactUpdatedPayload,
  GateUpdatedPayload,
  ClaimsUpdatedPayload,
  LiveEventEnvelope,
  LiveEventKind,
  LiveEventPayloadByKind,
  LiveEventScope,
  MissionUpdatedPayload,
  Run,
  Task,
  UsageUpdatedPayload,
} from "@pi-harness/shared";

export type LiveEventFilter =
  | { readonly scope: "dashboard"; readonly taskId?: never; readonly runId?: never }
  | { readonly taskId: string; readonly scope?: never; readonly runId?: never }
  | { readonly runId: string; readonly scope?: never; readonly taskId?: never };

type Subscriber = (event: LiveEventEnvelope) => void;

export class LiveEventStore {
  private readonly subs = new Set<{ readonly filter: LiveEventFilter; readonly sub: Subscriber }>();

  constructor(private readonly db: DbClient) {}

  publishTask(task: Task): Promise<LiveEventEnvelope<"task.updated">> {
    return this.publish({
      scope: "dashboard",
      taskId: task.id,
      kind: "task.updated",
      payload: task,
    });
  }

  publishRun(run: Run): Promise<LiveEventEnvelope<"run.updated">> {
    return this.publish({
      scope: "dashboard",
      taskId: run.taskId,
      runId: run.id,
      kind: "run.updated",
      payload: run,
    });
  }

  publishMissionUpdated(
    taskId: string,
    payload: MissionUpdatedPayload,
  ): Promise<LiveEventEnvelope<"mission.updated">> {
    return this.publish({
      scope: "task",
      taskId,
      kind: "mission.updated",
      payload,
    });
  }

  publishClaimsUpdated(
    taskId: string,
    payload: ClaimsUpdatedPayload,
  ): Promise<LiveEventEnvelope<"claims.updated">> {
    return this.publish({
      scope: "task",
      taskId,
      kind: "claims.updated",
      payload,
    });
  }

  async publishAgentEvent(event: AgentEvent): Promise<void> {
    await this.publish({
      scope: "run",
      taskId: event.taskId,
      runId: event.runId,
      kind: "agent.event.appended",
      payload: event,
    });

    const derived = derivedEvents(event);
    for (const input of derived) {
      await this.publish(input);
    }
  }

  async listAfter(
    filter: LiveEventFilter,
    afterSequence: number,
  ): Promise<LiveEventEnvelope[]> {
    const rows = await this.db
      .select()
      .from(liveEventsTable)
      .where(filterWhere(filter, afterSequence))
      .orderBy(asc(liveEventsTable.sequence));
    return rows.map(rowToEnvelope);
  }

  async latestSequence(): Promise<number> {
    const [row] = await this.db
      .select({ sequence: liveEventsTable.sequence })
      .from(liveEventsTable)
      .orderBy(desc(liveEventsTable.sequence))
      .limit(1);
    return row?.sequence ?? 0;
  }

  subscribe(filter: LiveEventFilter, sub: Subscriber): () => void {
    const entry = { filter, sub };
    this.subs.add(entry);
    return () => {
      this.subs.delete(entry);
    };
  }

  private async publish<K extends LiveEventKind>(
    input: PublishInput<K>,
  ): Promise<LiveEventEnvelope<K>> {
    const id = randomUUID();
    const ts = new Date();
    const [row] = await this.db
      .insert(liveEventsTable)
      .values({
        id,
        scope: input.scope,
        kind: input.kind,
        ts,
        payload: input.payload,
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
      })
      .returning();
    if (!row) throw new Error("live event insert returned no row");
    const event = rowToEnvelope(row) as LiveEventEnvelope<K>;
    this.emit(event);
    return event;
  }

  private emit(event: LiveEventEnvelope): void {
    for (const entry of this.subs) {
      if (matchesFilter(event, entry.filter)) entry.sub(event);
    }
  }
}

type PublishInput<K extends LiveEventKind> = {
  readonly scope: LiveEventScope;
  readonly kind: K;
  readonly payload: LiveEventPayloadByKind[K];
  readonly taskId?: string;
  readonly runId?: string;
};

function filterWhere(filter: LiveEventFilter, afterSequence: number) {
  const cursor = gt(liveEventsTable.sequence, afterSequence);
  if ("runId" in filter) return and(eq(liveEventsTable.runId, filter.runId), cursor);
  if ("taskId" in filter) return and(eq(liveEventsTable.taskId, filter.taskId), cursor);
  return and(eq(liveEventsTable.scope, filter.scope), cursor);
}

function matchesFilter(event: LiveEventEnvelope, filter: LiveEventFilter): boolean {
  if ("runId" in filter) return event.runId === filter.runId;
  if ("taskId" in filter) return event.taskId === filter.taskId;
  return event.scope === filter.scope;
}

function rowToEnvelope(row: typeof liveEventsTable.$inferSelect): LiveEventEnvelope {
  return {
    id: row.id,
    sequence: row.sequence,
    ts: row.ts,
    scope: row.scope as LiveEventScope,
    ...(row.taskId !== null ? { taskId: row.taskId } : {}),
    ...(row.runId !== null ? { runId: row.runId } : {}),
    kind: row.kind as LiveEventKind,
    payload: row.payload as LiveEventPayloadByKind[LiveEventKind],
  };
}

function derivedEvents(event: AgentEvent): readonly PublishInput<LiveEventKind>[] {
  return [
    ...artifactEvent(event),
    ...usageEvent(event),
    ...gateEvent(event),
  ];
}

function artifactEvent(event: AgentEvent): readonly PublishInput<"artifact.updated">[] {
  if (event.kind !== "brainstorm_artifact_edited" && event.kind !== "plan_artifact_edited") {
    return [];
  }
  const payload: ArtifactUpdatedPayload = {
    taskId: event.taskId,
    runId: event.runId,
    artifact: event.artifact,
    sourceEventId: event.id,
  };
  return [{ scope: "run", taskId: event.taskId, runId: event.runId, kind: "artifact.updated", payload }];
}

function usageEvent(event: AgentEvent): readonly PublishInput<"usage.updated">[] {
  if (event.kind !== "brainstorm_usage" && event.kind !== "plan_usage" && event.kind !== "code_usage") {
    return [];
  }
  const cumulative =
    event.kind === "code_usage"
      ? {}
      : {
          cumulativeInputTokens: event.cumulativeInputTokens,
          cumulativeOutputTokens: event.cumulativeOutputTokens,
          cumulativeCostUsd: event.cumulativeCostUsd,
        };
  const payload: UsageUpdatedPayload = {
    taskId: event.taskId,
    runId: event.runId,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    costUsd: event.costUsd,
    ...cumulative,
    sourceEventId: event.id,
  };
  return [{ scope: "run", taskId: event.taskId, runId: event.runId, kind: "usage.updated", payload }];
}

function gateEvent(event: AgentEvent): readonly PublishInput<"gate.updated">[] {
  if (!isGateRelevantEvent(event)) return [];
  const payload: GateUpdatedPayload = {
    taskId: event.taskId,
    runId: event.runId,
    sourceEventId: event.id,
    sourceKind: event.kind,
  };
  return [{ scope: "run", taskId: event.taskId, runId: event.runId, kind: "gate.updated", payload }];
}

function isGateRelevantEvent(event: AgentEvent): boolean {
  return (
    event.kind === "brainstorm_question" ||
    event.kind === "brainstorm_answer" ||
    event.kind === "brainstorm_revision_requested" ||
    event.kind === "brainstorm_mock_proposed" ||
    event.kind === "brainstorm_mock_revised" ||
    event.kind === "brainstorm_mock_selected" ||
    event.kind === "plan_revision_requested" ||
    (event.kind === "brainstorm_system" &&
      (event.systemKind === "status_changed" || event.systemKind === "blocked")) ||
    (event.kind === "plan_system" &&
      (event.systemKind === "status_changed" || event.systemKind === "blocked"))
  );
}
