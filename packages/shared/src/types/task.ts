export const TASK_STATUSES = [
  "backlog",
  "brainstorming",
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const WORKFLOWS = ["backend-feature"] as const;
export type Workflow = (typeof WORKFLOWS)[number];

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  workflow: Workflow | null;
  worktreePath: string | null;
  branchName: string | null;
  retryCount: number;
  // True only during brainstorm phase between artifact `status: ready` and
  // user approval. Sub-state of brainstorming, not its own status enum.
  awaitingApproval: boolean;
  createdAt: Date;
  updatedAt: Date;
};
