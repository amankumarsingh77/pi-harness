"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClaimEvent, LiveEventEnvelope, Run, Task } from "@pi-harness/shared";
import { MissionCommandShell } from "./mission-command-shell";
import { queries, queryKeys } from "@/lib/client/queries";
import type { MissionBundle } from "@/lib/api";

type TaskDetailData = {
  readonly task: Task;
  readonly runs: readonly Run[];
};

export function MissionCommandLive({
  taskId,
  initialTask,
  initialMission,
}: {
  readonly taskId: string;
  readonly initialTask: TaskDetailData;
  readonly initialMission: MissionBundle;
}) {
  const queryClient = useQueryClient();
  const taskQuery = useQuery({
    ...queries.getTask(taskId),
    initialData: initialTask,
  });
  const missionQuery = useQuery({
    ...queries.getMission(taskId),
    initialData: initialMission,
  });

  useEffect(() => {
    const es = new EventSource(`/api/live/stream?taskId=${encodeURIComponent(taskId)}`);
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mission(taskId) });
    };
    const handleTask = (ev: MessageEvent<string>): void => {
      const parsed = parseLiveEvent(ev.data, "task.updated");
      if (!parsed) {
        invalidate();
        return;
      }
      queryClient.setQueryData<TaskDetailData>(queryKeys.task(taskId), (curr) =>
        curr ? { ...curr, task: hydrateTask(parsed.payload) } : curr,
      );
    };
    const handleRun = (ev: MessageEvent<string>): void => {
      const parsed = parseLiveEvent(ev.data, "run.updated");
      if (!parsed) {
        invalidate();
        return;
      }
      const run = hydrateRun(parsed.payload);
      queryClient.setQueryData<TaskDetailData>(queryKeys.task(taskId), (curr) =>
        curr ? { ...curr, runs: mergeRuns(curr.runs, [run]) } : curr,
      );
    };
    const handleMission = (ev: MessageEvent<string>): void => {
      const parsed = parseLiveEvent(ev.data, "mission.updated");
      if (!parsed) {
        invalidate();
        return;
      }
      queryClient.setQueryData<MissionBundle>(queryKeys.mission(taskId), (curr) =>
        curr
          ? {
              ...curr,
              mission: parsed.payload.mission,
              events: mergeMissionEvents(curr.events, parsed.payload.event),
            }
          : curr,
      );
    };
    const handleClaims = (ev: MessageEvent<string>): void => {
      const parsed = parseLiveEvent(ev.data, "claims.updated");
      if (!parsed) {
        invalidate();
        return;
      }
      queryClient.setQueryData<MissionBundle>(queryKeys.mission(taskId), (curr) =>
        curr
          ? {
              ...curr,
              claims: [...parsed.payload.claims],
              claimEvents: mergeClaimEvents(curr.claimEvents, parsed.payload.claimEvents),
            }
          : curr,
      );
    };

    es.addEventListener("task.updated", handleTask);
    es.addEventListener("run.updated", handleRun);
    es.addEventListener("mission.updated", handleMission);
    es.addEventListener("claims.updated", handleClaims);
    es.onerror = invalidate;
    return () => es.close();
  }, [queryClient, taskId]);

  return (
    <MissionCommandShell
      task={taskQuery.data.task}
      runs={taskQuery.data.runs}
      mission={missionQuery.data.mission}
      claims={missionQuery.data.claims}
      missionEvents={missionQuery.data.events}
      claimEvents={missionQuery.data.claimEvents}
    />
  );
}

function parseLiveEvent<K extends LiveEventEnvelope["kind"]>(
  raw: string,
  kind: K,
): LiveEventEnvelope<K> | null {
  try {
    const parsed = JSON.parse(raw) as LiveEventEnvelope;
    return parsed.kind === kind ? parsed as LiveEventEnvelope<K> : null;
  } catch {
    return null;
  }
}

function hydrateTask(task: Task): Task {
  return {
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
  };
}

function hydrateRun(run: Run): Run {
  return {
    ...run,
    startedAt: new Date(run.startedAt),
    endedAt: run.endedAt ? new Date(run.endedAt) : null,
  };
}

function mergeRuns(existing: readonly Run[], incoming: readonly Run[]): Run[] {
  const byId = new Map(existing.map((run) => [run.id, run]));
  for (const run of incoming) byId.set(run.id, run);
  return [...byId.values()].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
}

function mergeMissionEvents(
  existing: MissionBundle["events"],
  event: MissionBundle["events"][number] | null,
): MissionBundle["events"] {
  if (!event) return existing;
  const key = missionEventKey(event);
  if (existing.some((item) => missionEventKey(item) === key)) return existing;
  return [...existing, event].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function mergeClaimEvents(
  existing: readonly ClaimEvent[],
  incoming: readonly ClaimEvent[],
): ClaimEvent[] {
  const byKey = new Map(existing.map((event) => [claimEventKey(event), event]));
  for (const event of incoming) byKey.set(claimEventKey(event), event);
  return [...byKey.values()].sort(
    (a, b) => new Date(claimEventTimestamp(a)).getTime() - new Date(claimEventTimestamp(b)).getTime(),
  );
}

function missionEventKey(event: MissionBundle["events"][number]): string {
  return `${event.type}:${event.ts}`;
}

function claimEventKey(event: ClaimEvent): string {
  return `${event.type}:${event.claimId}:${claimEventTimestamp(event)}`;
}

function claimEventTimestamp(event: ClaimEvent): string {
  return event.type === "claim.created" ? event.createdAt : event.updatedAt;
}
