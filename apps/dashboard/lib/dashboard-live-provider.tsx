"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  DashboardSnapshotPayload,
  Run,
  Task,
  TaskStatus,
} from "@pi-harness/shared";
import { TASK_STATUSES } from "@pi-harness/shared";
import { queryKeys } from "./client/queries";
import { buildLiveStreamUrl, parseLiveEnvelope } from "./live-event-client";
import type { Api } from "./api";

type TaskListData = Awaited<ReturnType<Api["listTasks"]>>;
type TaskDetailData = Awaited<ReturnType<Api["getTask"]>>;

export function DashboardLiveProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource(buildLiveStreamUrl({ scope: "dashboard" }));
    const onSnapshot = (ev: MessageEvent<string>) => {
      const parsed = parseLiveEnvelope(ev.data, "dashboard.snapshot");
      if (parsed) applySnapshot(queryClient, parsed.payload);
    };
    const onTaskUpdated = (ev: MessageEvent<string>) => {
      const parsed = parseLiveEnvelope(ev.data, "task.updated");
      if (parsed) applyTaskUpdated(queryClient, parsed.payload);
    };
    const onRunUpdated = (ev: MessageEvent<string>) => {
      const parsed = parseLiveEnvelope(ev.data, "run.updated");
      if (parsed) applyRunUpdated(queryClient, parsed.payload);
    };
    es.addEventListener("dashboard.snapshot", onSnapshot);
    es.addEventListener("task.updated", onTaskUpdated);
    es.addEventListener("run.updated", onRunUpdated);
    return () => es.close();
  }, [queryClient]);

  return <>{children}</>;
}

function applySnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
  payload: DashboardSnapshotPayload,
): void {
  queryClient.setQueryData<TaskListData>(queryKeys.tasks, {
    tasks: [...payload.tasks],
    counts: payload.counts,
    humanInterventionTaskIds: payload.humanInterventionTaskIds,
    summary: payload.summary,
  });
  for (const task of payload.tasks) {
    const taskRuns = payload.runs.filter((run) => run.taskId === task.id);
    queryClient.setQueryData<TaskDetailData>(queryKeys.task(task.id), (curr) =>
      curr ? { task, runs: mergeRuns(curr.runs, taskRuns) } : curr,
    );
  }
}

function applyTaskUpdated(
  queryClient: ReturnType<typeof useQueryClient>,
  task: Task,
): void {
  queryClient.setQueryData<TaskListData>(queryKeys.tasks, (curr) =>
    curr ? upsertTaskList(curr, task) : curr,
  );
  queryClient.setQueryData<TaskDetailData>(queryKeys.task(task.id), (curr) =>
    curr ? { ...curr, task } : curr,
  );
}

function applyRunUpdated(
  queryClient: ReturnType<typeof useQueryClient>,
  run: Run,
): void {
  queryClient.setQueryData<TaskListData>(queryKeys.tasks, (curr) =>
    curr ? { ...curr, summary: summaryWithRun(curr.summary, run) } : curr,
  );
  queryClient.setQueryData<TaskDetailData>(queryKeys.task(run.taskId), (curr) =>
    curr ? { ...curr, runs: mergeRuns(curr.runs, [run]) } : curr,
  );
}

function upsertTaskList(curr: TaskListData, task: Task): TaskListData {
  const exists = curr.tasks.some((t) => t.id === task.id);
  const tasks = exists
    ? curr.tasks.map((t) => (t.id === task.id ? task : t))
    : [...curr.tasks, task];
  const counts = countTasks(tasks);
  return {
    ...curr,
    tasks,
    counts,
    summary: summaryWithCounts(curr.summary, counts),
  };
}

function mergeRuns(existing: readonly Run[], incoming: readonly Run[]): Run[] {
  const byId = new Map(existing.map((run) => [run.id, run]));
  for (const run of incoming) byId.set(run.id, run);
  return [...byId.values()].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );
}

function countTasks(tasks: readonly Task[]): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function summaryWithCounts(
  summary: TaskListData["summary"],
  counts: Record<TaskStatus, number>,
): TaskListData["summary"] {
  return {
    ...summary,
    runningCount: runningCount(counts),
    blockedCount: blockedCount(counts),
  };
}

function summaryWithRun(summary: TaskListData["summary"], run: Run): TaskListData["summary"] {
  const activeRunIds = activeRunIdsWith(summary.activeRunIds, run);
  return {
    ...summary,
    activeRunIds,
    runningCount: activeRunIds.length,
    lastEventAt: new Date(),
  };
}

function activeRunIdsWith(activeRunIds: readonly string[], run: Run): string[] {
  const active = run.status === "pending" || run.status === "running";
  if (active && !activeRunIds.includes(run.id)) return [...activeRunIds, run.id];
  if (!active) return activeRunIds.filter((id) => id !== run.id);
  return [...activeRunIds];
}

function runningCount(counts: Record<TaskStatus, number>): number {
  return counts.brainstorming + counts.planning + counts.executing + counts.verifying;
}

function blockedCount(counts: Record<TaskStatus, number>): number {
  return (
    counts.brainstorm_failed +
    counts.plan_failed +
    counts.code_failed +
    counts.verification_failed +
    counts.pr_failed
  );
}
