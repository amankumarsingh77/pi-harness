export const PHASES = [
  "brainstorm",
  "plan",
  "code",
  "verify",
  "pr",
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export type Run = {
  id: string;
  taskId: string;
  phase: Phase;
  status: PhaseStatus;
  startedAt: Date;
  endedAt: Date | null;
  error: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  // Brainstorm-only today: absolute path to the pi-coding-agent session
  // log this Run resumes from across orchestrator restarts. Null for runs
  // that don't (yet) drive a resumable LLM session.
  piSessionPath: string | null;
};
