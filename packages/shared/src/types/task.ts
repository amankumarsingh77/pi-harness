import type { Phase } from "./run.js";
import type { PhaseModelConfig } from "../config/phase-models.js";

export const TASK_STATUSES = [
  "backlog",
  "brainstorming",
  "brainstorm_failed",
  "planning",
  "plan_failed",
  "executing",
  "code_failed",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "pr_failed",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["none", "urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// Single source of truth: which phase the next dispatch should run, given
// a task's current status. `null` means the task is terminal or gated on
// human input — the run-loop must not auto-dispatch.
export const STATUS_TO_PHASE: Record<TaskStatus, Phase | null> = {
  backlog: null,
  brainstorming: "brainstorm",
  brainstorm_failed: null, // user must triage / restart
  planning: "plan", // run-loop dispatches plan agent; gate stops dispatch when artifacts ready
  plan_failed: null, // user must triage / restart
  executing: "code",
  code_failed: null, // user must triage / restart
  verifying: "verify",
  verification_failed: null, // user must triage
  ready_to_ship: "pr",
  pr_failed: null, // user must triage / restart
  done: null,
  cancelled: null,
};

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
  priority: TaskPriority;
  tags: readonly string[];
  // Per-phase model overrides. Empty object = use DEFAULT_PHASE_MODELS for
  // every phase. Phase keys are optional; per-phase fields are also optional
  // so partial overrides merge with defaults via mergePhaseModels.
  phaseModels: Partial<Record<Phase, Partial<PhaseModelConfig>>>;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardSummary = {
  runningCount: number;
  reviewCount: number;
  blockedCount: number;
  costUsd: number;
  costCapUsd: number;
  lastEventAt: Date | null;
  activeRunIds: readonly string[];
};
