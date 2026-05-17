"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DashboardEvent, Run, Task, TaskStatus } from "@pi-harness/shared";
import { TASK_STATUSES } from "@pi-harness/shared";
import { queryKeys } from "./client/queries";
import type { Api } from "./api";

type TaskListData = Awaited<ReturnType<Api["listTasks"]>>;
type TaskDetailData = Awaited<ReturnType<Api["getTask"]>>;

export function DashboardLiveProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource("/api/sse/dashboard");
    es.onmessage = (ev) => {
      const parsed = parseDashboardEvent(ev.data);
      if (parsed === null) return;
      applyDashboardEvent(queryClient, parsed);
    };
    return () => es.close();
  }, [queryClient]);

  return <>{children}</>;
}

function applyDashboardEvent(
  queryClient: ReturnType<typeof useQueryClient>,
  event: DashboardEvent,
): void {
  if (event.kind === "tasks_snapshot") {
    queryClient.setQueryData<TaskListData>(queryKeys.tasks, (curr) => ({
      tasks: event.tasks,
      counts: event.counts,
      humanInterventionTaskIds: curr?.humanInterventionTaskIds ?? [],
      summary: curr
        ? summaryWithCounts(curr.summary, event.counts)
        : emptySummary(event.counts),
    }));
    for (const task of event.tasks) {
      const taskRuns = event.runs.filter((run) => run.taskId === task.id);
      queryClient.setQueryData<TaskDetailData>(queryKeys.task(task.id), (curr) =>
        curr ? { task, runs: mergeRuns(curr.runs, taskRuns) } : curr,
      );
    }
    return;
  }

  if (event.kind === "task_updated") {
    queryClient.setQueryData<TaskListData>(queryKeys.tasks, (curr) =>
      curr ? upsertTaskList(curr, event.task) : curr,
    );
    queryClient.setQueryData<TaskDetailData>(queryKeys.task(event.task.id), (curr) =>
      curr ? { ...curr, task: event.task } : curr,
    );
    return;
  }

  queryClient.setQueryData<TaskDetailData>(queryKeys.task(event.run.taskId), (curr) =>
    curr ? { ...curr, runs: mergeRuns(curr.runs, [event.run]) } : curr,
  );
}

function parseDashboardEvent(raw: string): DashboardEvent | null {
  try {
    return hydrateDashboardEvent(JSON.parse(raw));
  } catch {
    return null;
  }
}

function hydrateDashboardEvent(value: unknown): DashboardEvent | null {
  if (!isRecord(value) || typeof value["kind"] !== "string") return null;
  const base = {
    id: typeof value["id"] === "string" ? value["id"] : "",
    ts: toDate(value["ts"]),
  };
  if (eventBaseInvalid(base)) return null;

  if (value["kind"] === "tasks_snapshot") {
    if (!Array.isArray(value["tasks"]) || !Array.isArray(value["runs"])) return null;
    return {
      ...base,
      kind: "tasks_snapshot",
      tasks: value["tasks"].map(hydrateTaskLike).filter(isTask),
      counts: normalizeCounts(value["counts"]),
      runs: value["runs"].map(hydrateRunLike).filter(isRun),
    };
  }
  if (value["kind"] === "task_updated") {
    const task = hydrateTaskLike(value["task"]);
    return isTask(task) ? { ...base, kind: "task_updated", task } : null;
  }
  if (value["kind"] === "run_updated") {
    const run = hydrateRunLike(value["run"]);
    return isRun(run) ? { ...base, kind: "run_updated", run } : null;
  }
  return null;
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

function mergeRuns(existing: Run[], incoming: Run[]): Run[] {
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

function normalizeCounts(value: unknown): Record<TaskStatus, number> {
  if (!isRecord(value)) return countTasks([]);
  const counts = countTasks([]);
  for (const status of TASK_STATUSES) {
    const n = value[status];
    if (typeof n === "number") counts[status] = n;
  }
  return counts;
}

function emptySummary(counts: Record<TaskStatus, number>): TaskListData["summary"] {
  return {
    runningCount: runningCount(counts),
    reviewCount: 0,
    blockedCount: blockedCount(counts),
    costUsd: 0,
    costCapUsd: 10,
    lastEventAt: null,
    activeRunIds: [],
  };
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

function runningCount(counts: Record<TaskStatus, number>): number {
  return (
    counts.brainstorming +
    counts.planning +
    counts.executing +
    counts.verifying
  );
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

function hydrateTaskLike(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    createdAt: toDate(value["createdAt"]),
    updatedAt: toDate(value["updatedAt"]),
  };
}

function hydrateRunLike(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    startedAt: toDate(value["startedAt"]),
    endedAt: value["endedAt"] === null ? null : toDate(value["endedAt"]),
  };
}

function eventBaseInvalid(base: { id: string; ts: Date }): boolean {
  return base.id.length === 0 || Number.isNaN(base.ts.getTime());
}

function isTask(value: unknown): value is Task {
  return isRecord(value) && typeof value["id"] === "string" && value["createdAt"] instanceof Date;
}

function isRun(value: unknown): value is Run {
  return isRecord(value) && typeof value["id"] === "string" && value["startedAt"] instanceof Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
