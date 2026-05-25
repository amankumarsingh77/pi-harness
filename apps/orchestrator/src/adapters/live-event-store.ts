import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { TASK_STATUSES } from "@pi-harness/shared";
import type {
  AgentEvent,
  ArtifactUpdatedPayload,
  GateUpdatedPayload,
  ClaimsUpdatedPayload,
  DashboardSummary,
  LiveEventEnvelope,
  LiveEventKind,
  LiveEventPayloadByKind,
  LiveEventScope,
  MissionUpdatedPayload,
  Run,
  Task,
  UsageUpdatedPayload,
  TaskStatus,
} from "@pi-harness/shared";
import { appendJsonl, readJsonl } from "./jsonl-writer.js";

export type LiveEventFilter =
  | { readonly scope: "dashboard"; readonly taskId?: never; readonly runId?: never }
  | { readonly taskId: string; readonly scope?: never; readonly runId?: never }
  | { readonly runId: string; readonly scope?: never; readonly taskId?: never };

export type LiveEventStoreOpts = {
  readonly stateDir: string;
};

type Subscriber = (event: LiveEventEnvelope) => void;

type SerializedLiveEventEnvelope = Omit<LiveEventEnvelope, "ts"> & {
  readonly ts: string;
};

export class LiveEventStore {
  private readonly subs = new Set<{ readonly filter: LiveEventFilter; readonly sub: Subscriber }>();
  private readonly liveEventLogPath: string;
  private sequenceChain: Promise<void> = Promise.resolve();

  constructor(opts: LiveEventStoreOpts) {
    this.liveEventLogPath = join(opts.stateDir, "store", "live-events.jsonl");
  }

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
    return (await this.listAll())
      .filter((event) => event.sequence > afterSequence && matchesFilter(event, filter))
      .sort((a, b) => a.sequence - b.sequence);
  }

  async latestSequence(): Promise<number> {
    return Math.max(0, ...(await this.listAll()).map((event) => event.sequence));
  }

  subscribe(filter: LiveEventFilter, sub: Subscriber): () => void {
    const entry = { filter, sub };
    this.subs.add(entry);
    return () => {
      this.subs.delete(entry);
    };
  }

  private publish<K extends LiveEventKind>(
    input: PublishInput<K>,
  ): Promise<LiveEventEnvelope<K>> {
    return this.runSequential(async () => {
      const event: LiveEventEnvelope<K> = {
        id: randomUUID(),
        sequence: (await this.latestSequence()) + 1,
        ts: new Date(),
        scope: input.scope,
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        kind: input.kind,
        payload: input.payload,
      };
      await appendJsonl(this.liveEventLogPath, serializeLiveEvent(event));
      this.emit(event);
      return event;
    });
  }

  private runSequential<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.sequenceChain.then(fn, fn);
    this.sequenceChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private emit(event: LiveEventEnvelope): void {
    for (const entry of this.subs) {
      if (matchesFilter(event, entry.filter)) entry.sub(event);
    }
  }

  private async listAll(): Promise<LiveEventEnvelope[]> {
    return (await readJsonl<unknown>(this.liveEventLogPath))
      .map(parseLiveEvent)
      .filter((event): event is LiveEventEnvelope => event !== null)
      .sort((a, b) => a.sequence - b.sequence);
  }
}

type PublishInput<K extends LiveEventKind> = {
  readonly scope: LiveEventScope;
  readonly kind: K;
  readonly payload: LiveEventPayloadByKind[K];
  readonly taskId?: string;
  readonly runId?: string;
};

function matchesFilter(event: LiveEventEnvelope, filter: LiveEventFilter): boolean {
  if ("runId" in filter) return event.runId === filter.runId;
  if ("taskId" in filter) return event.taskId === filter.taskId;
  return event.scope === filter.scope;
}

function serializeLiveEvent(event: LiveEventEnvelope): SerializedLiveEventEnvelope {
  return {
    ...event,
    ts: event.ts.toISOString(),
  };
}

function parseLiveEvent(value: unknown): LiveEventEnvelope | null {
  if (!isRecord(value)) return null;
  const ts = parseDate(value["ts"]);
  if (
    !ts ||
    typeof value["id"] !== "string" ||
    typeof value["sequence"] !== "number" ||
    typeof value["scope"] !== "string" ||
    typeof value["kind"] !== "string" ||
    !("payload" in value)
  ) {
    return null;
  }
  return {
    id: value["id"],
    sequence: value["sequence"],
    ts,
    scope: value["scope"] as LiveEventScope,
    ...(typeof value["taskId"] === "string" ? { taskId: value["taskId"] } : {}),
    ...(typeof value["runId"] === "string" ? { runId: value["runId"] } : {}),
    kind: value["kind"] as LiveEventKind,
    payload: decodePayload(value["kind"], value["payload"]),
  };
}

function decodePayload(kind: string, payload: unknown): LiveEventPayloadByKind[LiveEventKind] {
  if (kind === "task.updated") return decodeTaskPayload(payload);
  if (kind === "run.updated") return decodeRunPayload(payload);
  if (kind === "agent.event.appended") return decodeAgentEventPayload(payload);
  if (kind === "dashboard.snapshot") return decodeDashboardPayload(payload);
  return payload as LiveEventPayloadByKind[LiveEventKind];
}

function decodeDashboardPayload(payload: unknown): LiveEventPayloadByKind["dashboard.snapshot"] {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload["tasks"]) ||
    !Array.isArray(payload["runs"]) ||
    !isRecord(payload["counts"]) ||
    !isRecord(payload["summary"]) ||
    !Array.isArray(payload["humanInterventionTaskIds"])
  ) {
    return payload as LiveEventPayloadByKind["dashboard.snapshot"];
  }
  return {
    counts: parseCounts(payload["counts"]),
    summary: parseSummary(payload["summary"]),
    humanInterventionTaskIds: payload["humanInterventionTaskIds"],
    tasks: payload["tasks"].map(decodeTaskPayload),
    runs: payload["runs"].map(decodeRunPayload),
  };
}

function parseCounts(value: Readonly<Record<string, unknown>>): Record<TaskStatus, number> {
  return Object.fromEntries(
    TASK_STATUSES.map((status) => [
      status,
      typeof value[status] === "number" ? value[status] : 0,
    ]),
  ) as Record<TaskStatus, number>;
}

function parseSummary(value: Readonly<Record<string, unknown>>): DashboardSummary {
  return {
    runningCount: typeof value["runningCount"] === "number" ? value["runningCount"] : 0,
    reviewCount: typeof value["reviewCount"] === "number" ? value["reviewCount"] : 0,
    blockedCount: typeof value["blockedCount"] === "number" ? value["blockedCount"] : 0,
    costUsd: typeof value["costUsd"] === "number" ? value["costUsd"] : 0,
    costCapUsd: typeof value["costCapUsd"] === "number" ? value["costCapUsd"] : 10,
    lastEventAt: value["lastEventAt"] === null ? null : parseDate(value["lastEventAt"]),
    activeRunIds: Array.isArray(value["activeRunIds"])
      ? value["activeRunIds"].filter((id): id is string => typeof id === "string")
      : [],
  };
}

function decodeTaskPayload(payload: unknown): Task {
  if (!isRecord(payload)) return payload as Task;
  return {
    ...payload,
    createdAt: parseDate(payload["createdAt"]) ?? new Date(0),
    updatedAt: parseDate(payload["updatedAt"]) ?? new Date(0),
  } as Task;
}

function decodeRunPayload(payload: unknown): Run {
  if (!isRecord(payload)) return payload as Run;
  return {
    ...payload,
    startedAt: parseDate(payload["startedAt"]) ?? new Date(0),
    endedAt: payload["endedAt"] === null ? null : parseDate(payload["endedAt"]) ?? null,
  } as Run;
}

function decodeAgentEventPayload(payload: unknown): AgentEvent {
  if (!isRecord(payload)) return payload as AgentEvent;
  return {
    ...payload,
    ts: parseDate(payload["ts"]) ?? new Date(0),
  } as AgentEvent;
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

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
