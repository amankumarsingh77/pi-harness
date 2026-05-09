import type { Phase, Task, TaskStatus, Workflow } from "@pi-harness/shared";
import { InvalidTransitionError } from "./errors.js";

// Action input — discriminated union of every event that can change a task's state.
export type TransitionAction =
  | { type: "user_start_brainstorm"; workflow: Workflow }
  | { type: "user_approve_brainstorm" }
  | { type: "user_request_brainstorm_changes"; comment: string }
  | { type: "user_approve_plan" }
  | { type: "user_approve_scenarios" }
  | { type: "user_cancel" }
  | { type: "user_retry_failed" }
  | { type: "agent_phase_succeeded"; phase: Phase }
  | { type: "agent_phase_failed"; phase: Phase; retryCap: number }
  | { type: "agent_brainstorm_ready" };

export type TransitionResult =
  | { ok: true; task: Task }
  | { ok: false; error: InvalidTransitionError };

// Map (current_status, action) → next_status. Returning a value (not throwing)
// makes the whole machine exhaustive and testable; callers decide what to do
// with the error.
export function transition(task: Task, action: TransitionAction): TransitionResult {
  const now = new Date();
  const advance = (status: TaskStatus, extra: Partial<Task> = {}): TransitionResult => ({
    ok: true,
    task: { ...task, ...extra, status, updatedAt: now },
  });
  const reject = (reason: string): TransitionResult => ({
    ok: false,
    error: new InvalidTransitionError(task.status, "?", reason),
  });

  switch (action.type) {
    case "user_start_brainstorm":
      if (task.status !== "backlog") return reject("must be in backlog");
      return advance("brainstorming", { workflow: action.workflow });

    case "agent_brainstorm_ready":
      // Subagent produced design+spec with status: ready. Stop the run-loop
      // here — task stays in brainstorming until the user approves.
      if (task.status !== "brainstorming") return reject("must be in brainstorming");
      return advance("brainstorming", { awaitingApproval: true });

    case "user_approve_brainstorm":
      if (task.status !== "brainstorming") return reject("must be in brainstorming");
      if (!task.awaitingApproval) return reject("artifacts not ready for approval");
      return advance("planning", { awaitingApproval: false });

    case "user_request_brainstorm_changes":
      if (task.status !== "brainstorming") return reject("must be in brainstorming");
      if (!task.awaitingApproval) return reject("not awaiting approval");
      // Stay in brainstorming; clear gate flag so the run-loop re-dispatches
      // and the agent resumes from JSONL cursor.
      return advance("brainstorming", { awaitingApproval: false });

    case "user_approve_plan":
      // Brainstorm → Planning happens when brainstorm phase succeeds.
      // Planning → Executing happens when *user* approves plan.
      if (task.status !== "planning") return reject("must be in planning");
      return advance("executing");

    case "user_approve_scenarios":
      // v1 scenarios are reviewed in the same step as the plan; this is reserved
      // for v2 when scenario review becomes its own step.
      if (task.status !== "planning") return reject("must be in planning");
      return advance("executing");

    case "user_cancel":
      if (task.status === "done" || task.status === "cancelled") {
        return reject("already terminal");
      }
      return advance("cancelled");

    case "user_retry_failed":
      if (task.status !== "verification_failed") return reject("not failed");
      // Reset retry counter — user has triaged.
      return advance("executing", { retryCount: 0 });

    case "agent_phase_succeeded": {
      // Brainstorm has its own gate — it never auto-advances. The run-loop
      // dispatches `agent_brainstorm_ready` instead when artifacts are ready.
      // We accept `agent_phase_succeeded` for brainstorm here as a no-op so
      // legacy callers (and tests) don't break, but it does NOT advance.
      if (action.phase === "brainstorm") {
        if (task.status !== "brainstorming") return reject("expected brainstorming");
        return advance("brainstorming", { awaitingApproval: true });
      }
      const map: Partial<Record<Phase, { from: TaskStatus; to: TaskStatus }>> = {
        plan: { from: "planning", to: "planning" }, // wait for user approval
        code: { from: "executing", to: "verifying" },
        verify: { from: "verifying", to: "ready_to_ship" },
        pr: { from: "ready_to_ship", to: "done" },
      };
      const m = map[action.phase];
      if (!m) return reject(`no rule for phase ${action.phase}`);
      if (task.status !== m.from) return reject(`expected ${m.from}, got ${task.status}`);
      return advance(m.to);
    }

    case "agent_phase_failed":
      if (action.phase === "verify") {
        // Spec §8.3 — verify failures retry (retryCap times) before triage.
        if (task.retryCount < action.retryCap) {
          return advance("executing", { retryCount: task.retryCount + 1 });
        }
        return advance("verification_failed");
      }
      // Any other phase failing puts the task in verification_failed for triage.
      // (No silent retries on brainstorm/plan/code/pr.)
      return advance("verification_failed");
  }
}

export function canStart(opts: { runningCount: number; cap: number }): boolean {
  return opts.runningCount < opts.cap;
}
