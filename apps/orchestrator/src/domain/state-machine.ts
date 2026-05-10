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
      // Subagent produced design+spec with status: ready. The gate is now
      // derived from artifact frontmatter + JSONL events (see
      // deriveBrainstormGate); the state machine no longer stores a flag.
      // Task stays in brainstorming until the user approves.
      if (task.status !== "brainstorming") return reject("must be in brainstorming");
      return advance("brainstorming");

    case "user_approve_brainstorm":
      // The route validates the gate is open (deriveBrainstormGate ===
      // "awaiting_user") before dispatching this transition. The state
      // machine only sees structurally-valid actions.
      if (task.status !== "brainstorming") return reject("must be in brainstorming");
      return advance("planning");

    case "user_request_brainstorm_changes":
      // Same contract as approve — the route enforces the gate. We stay in
      // brainstorming; the route also writes a brainstorm_revision_requested
      // event and resets artifact frontmatter to draft, both of which flip
      // the derived gate back to "running" on the next read.
      if (task.status !== "brainstorming") return reject("must be in brainstorming");
      return advance("brainstorming");

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

    case "user_retry_failed": {
      // Each failed sub-status retries back into its original phase. Reset
      // retryCount — the user has triaged, the previous count is no longer
      // meaningful for the new attempt.
      const retryTarget: Partial<Record<TaskStatus, TaskStatus>> = {
        verification_failed: "executing",
        brainstorm_failed: "brainstorming",
        plan_failed: "planning",
        code_failed: "executing",
        pr_failed: "ready_to_ship",
      };
      const next = retryTarget[task.status];
      if (!next) return reject("not failed");
      return advance(next, { retryCount: 0 });
    }

    case "agent_phase_succeeded": {
      // Brainstorm has its own gate — it never auto-advances. The run-loop
      // dispatches `agent_brainstorm_ready` instead when artifacts are ready.
      // We accept `agent_phase_succeeded` for brainstorm here as a no-op so
      // legacy callers (and tests) don't break, but it does NOT advance.
      if (action.phase === "brainstorm") {
        if (task.status !== "brainstorming") return reject("expected brainstorming");
        return advance("brainstorming");
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
      // Phase-scoped failure: the task stays under its phase's UI surface
      // (kanban column, detail page) with a red-border alert, instead of
      // jumping to the catch-all verification_failed column. The user
      // triages by clicking Restart, which fires user_retry_failed.
      switch (action.phase) {
        case "brainstorm":
          return advance("brainstorm_failed");
        case "plan":
          return advance("plan_failed");
        case "code":
          return advance("code_failed");
        case "pr":
          return advance("pr_failed");
      }
  }
}

export function canStart(opts: { runningCount: number; cap: number }): boolean {
  return opts.runningCount < opts.cap;
}
