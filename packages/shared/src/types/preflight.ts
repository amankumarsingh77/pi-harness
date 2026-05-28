export const PREFLIGHT_STEP_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "skipped",
  "fallback_succeeded",
] as const;

export type PreflightStepStatus = (typeof PREFLIGHT_STEP_STATUSES)[number];

export type PreflightStep = {
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly subagent: string;
  readonly status: PreflightStepStatus;
  readonly required: boolean;
  readonly artifactPath: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly error: string | null;
  readonly fallbackReason: string | null;
};
