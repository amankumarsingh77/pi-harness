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

export type TaskStatusVisualKind = "intake" | "progress" | "blocked" | "shipping" | "done";

export type TaskStatusDefinition = {
  readonly dispatchPhase: Phase | null;
  readonly displayPhase: Phase | "intake" | "done" | "cancelled";
  readonly cancelablePhase: "brainstorm" | "plan" | null;
  readonly running: boolean;
  readonly blocked: boolean;
  readonly terminal: boolean;
  readonly statusLabel: "queued" | "needs input" | "running" | "blocked" | "done" | "cancelled";
  readonly visualKind: TaskStatusVisualKind;
};

export const TASK_STATUS_DEFINITIONS = {
  backlog: {
    dispatchPhase: null,
    displayPhase: "intake",
    cancelablePhase: null,
    running: false,
    blocked: false,
    terminal: false,
    statusLabel: "queued",
    visualKind: "intake",
  },
  brainstorming: {
    dispatchPhase: "brainstorm",
    displayPhase: "brainstorm",
    cancelablePhase: "brainstorm",
    running: true,
    blocked: false,
    terminal: false,
    statusLabel: "needs input",
    visualKind: "progress",
  },
  brainstorm_failed: {
    dispatchPhase: null,
    displayPhase: "brainstorm",
    cancelablePhase: null,
    running: false,
    blocked: true,
    terminal: false,
    statusLabel: "blocked",
    visualKind: "blocked",
  },
  planning: {
    dispatchPhase: "plan",
    displayPhase: "plan",
    cancelablePhase: "plan",
    running: true,
    blocked: false,
    terminal: false,
    statusLabel: "needs input",
    visualKind: "progress",
  },
  plan_failed: {
    dispatchPhase: null,
    displayPhase: "plan",
    cancelablePhase: null,
    running: false,
    blocked: true,
    terminal: false,
    statusLabel: "blocked",
    visualKind: "blocked",
  },
  executing: {
    dispatchPhase: "code",
    displayPhase: "code",
    cancelablePhase: null,
    running: true,
    blocked: false,
    terminal: false,
    statusLabel: "running",
    visualKind: "progress",
  },
  code_failed: {
    dispatchPhase: null,
    displayPhase: "code",
    cancelablePhase: null,
    running: false,
    blocked: true,
    terminal: false,
    statusLabel: "blocked",
    visualKind: "blocked",
  },
  verifying: {
    dispatchPhase: "verify",
    displayPhase: "verify",
    cancelablePhase: null,
    running: true,
    blocked: false,
    terminal: false,
    statusLabel: "running",
    visualKind: "progress",
  },
  verification_failed: {
    dispatchPhase: null,
    displayPhase: "verify",
    cancelablePhase: null,
    running: false,
    blocked: true,
    terminal: false,
    statusLabel: "blocked",
    visualKind: "blocked",
  },
  ready_to_ship: {
    dispatchPhase: "pr",
    displayPhase: "pr",
    cancelablePhase: null,
    running: false,
    blocked: false,
    terminal: false,
    statusLabel: "running",
    visualKind: "shipping",
  },
  pr_failed: {
    dispatchPhase: null,
    displayPhase: "pr",
    cancelablePhase: null,
    running: false,
    blocked: true,
    terminal: false,
    statusLabel: "blocked",
    visualKind: "blocked",
  },
  done: {
    dispatchPhase: null,
    displayPhase: "done",
    cancelablePhase: null,
    running: false,
    blocked: false,
    terminal: true,
    statusLabel: "done",
    visualKind: "done",
  },
  cancelled: {
    dispatchPhase: null,
    displayPhase: "cancelled",
    cancelablePhase: null,
    running: false,
    blocked: false,
    terminal: true,
    statusLabel: "cancelled",
    visualKind: "blocked",
  },
} satisfies Record<TaskStatus, TaskStatusDefinition>;

export function phaseForTaskStatus(status: TaskStatus): Phase | null {
  return TASK_STATUS_DEFINITIONS[status].dispatchPhase;
}

export function cancelablePhaseForTaskStatus(status: TaskStatus): "brainstorm" | "plan" | null {
  return TASK_STATUS_DEFINITIONS[status].cancelablePhase;
}

export function isRunningTaskStatus(status: TaskStatus): boolean {
  return TASK_STATUS_DEFINITIONS[status].running;
}

export function isBlockedTaskStatus(status: TaskStatus): boolean {
  return TASK_STATUS_DEFINITIONS[status].blocked;
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TASK_STATUS_DEFINITIONS[status].terminal;
}

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_DEFINITIONS[status].statusLabel;
}

export function taskPhaseLabel(status: TaskStatus): string {
  return TASK_STATUS_DEFINITIONS[status].displayPhase;
}

export function taskStatusVisualKind(status: TaskStatus): TaskStatusVisualKind {
  return TASK_STATUS_DEFINITIONS[status].visualKind;
}

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
