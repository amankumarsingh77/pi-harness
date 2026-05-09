import type { Phase } from "./run.js";
import type { PhaseModelConfig } from "../config/phase-models.js";

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

// Single source of truth: which phase the next dispatch should run, given
// a task's current status. `null` means the task is terminal or gated on
// human input — the run-loop must not auto-dispatch.
export const STATUS_TO_PHASE: Record<TaskStatus, Phase | null> = {
  backlog: null,
  brainstorming: "brainstorm",
  planning: null, // user must approve plan
  executing: "code",
  verifying: "verify",
  verification_failed: null, // user must triage
  ready_to_ship: "pr",
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
  // True only during brainstorm phase between artifact `status: ready` and
  // user approval. Sub-state of brainstorming, not its own status enum.
  awaitingApproval: boolean;
  // Per-phase model overrides. Empty object = use DEFAULT_PHASE_MODELS for
  // every phase. Phase keys are optional; per-phase fields are also optional
  // so partial overrides merge with defaults via mergePhaseModels.
  phaseModels: Partial<Record<Phase, Partial<PhaseModelConfig>>>;
  createdAt: Date;
  updatedAt: Date;
};
