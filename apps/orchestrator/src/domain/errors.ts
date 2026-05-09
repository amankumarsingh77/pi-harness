export type HarnessErrorCode =
  | "invalid_transition"
  | "not_found"
  | "validation"
  | "dispatch_failed"
  | "worktree_failed"
  | "internal";

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: HarnessErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InvalidTransitionError extends HarnessError {
  constructor(from: string, to: string, reason: string) {
    super(
      "invalid_transition",
      409,
      `cannot transition from ${from} to ${to}: ${reason}`,
      { from, to, reason },
    );
  }
}

export class NotFoundError extends HarnessError {
  constructor(resource: string, id: string) {
    super("not_found", 404, `${resource} not found: ${id}`, { resource, id });
  }
}

export class ValidationError extends HarnessError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("validation", 400, message, details);
  }
}

export class DispatchError extends HarnessError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("dispatch_failed", 500, message, details);
  }
}

export class WorktreeError extends HarnessError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("worktree_failed", 500, message, details);
  }
}

export function isHarnessError(e: unknown): e is HarnessError {
  return e instanceof HarnessError;
}
