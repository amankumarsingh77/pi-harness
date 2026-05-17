export type RunOutcome =
  | { kind: "running"; phase: string }
  | { kind: "blocked"; phase: string; note: string }
  | { kind: "review"; phase: string }
  | { kind: "shipping"; phase: string; pr: number }
  | { kind: "merged"; pr: number }
  | { kind: "failed"; phase: string }
  | { kind: "abandoned"; phase: string };

export type MockRun = {
  id: string;
  taskId: string;
  taskTitle: string;
  attempt: number;
  branch: string;
  startedAt: string;
  durationMs: number;
  outcome: RunOutcome;
};
