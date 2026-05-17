import type { Run } from "./run.js";
import type { Task, TaskStatus } from "./task.js";

export type DashboardEventBase = {
  id: string;
  ts: Date;
};

export type DashboardEvent =
  | (DashboardEventBase & {
      kind: "tasks_snapshot";
      tasks: Task[];
      counts: Record<TaskStatus, number>;
      runs: Run[];
    })
  | (DashboardEventBase & {
      kind: "task_updated";
      task: Task;
    })
  | (DashboardEventBase & {
      kind: "run_updated";
      run: Run;
    });
