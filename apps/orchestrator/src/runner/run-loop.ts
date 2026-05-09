import type { Phase, Run, Task } from "@pi-harness/shared";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { WorktreeManager } from "../adapters/worktree.js";
import { transition } from "../domain/state-machine.js";
import { phasesFor } from "../domain/phase-chain.js";
import { runPhase, type PhaseDeps } from "./phase-prompts.js";
import { scaffoldBrainstorm } from "./scaffold-brainstorm.js";

export type RunLoopOpts = {
  task: Task;
  runs: RunStore;
  events: EventStore;
  // Base deps — `cwd` on this is ignored by the run-loop. We always run the
  // phase in the task's worktree, so we override cwd per-task before calling
  // runPhase.
  phaseDeps: PhaseDeps;
  worktrees: WorktreeManager;
  retryCap: number;
};

// Map current task.status → which Phase the next dispatch should be.
// Returns null when the task needs human input or is terminal.
function phaseToRun(status: Task["status"]): Phase | null {
  switch (status) {
    case "brainstorming": return "brainstorm";
    case "executing":     return "code";
    case "verifying":     return "verify";
    case "ready_to_ship": return "pr";
    case "planning":      return null; // user must approve plan
    case "verification_failed": return null; // user must triage
    case "backlog":
    case "done":
    case "cancelled":
      return null;
  }
}

// Branch name convention. Per design doc Decision #2: `pi/T-NNN`.
function branchNameFor(taskId: string): string {
  return `pi/${taskId}`;
}

// Drives the task through its phase chain. Each call advances at most one
// phase — it stops on completion, on a status that requires human input, or on
// failure. The orchestrator's main scheduler loops on this until the task is
// done or blocked.
export async function runLoop(opts: RunLoopOpts): Promise<Task> {
  const { runs, events, phaseDeps, worktrees, retryCap } = opts;
  let task = opts.task;

  if (!task.workflow) return task;
  // Touch phasesFor to validate the workflow has a chain (throws otherwise).
  phasesFor(task.workflow);

  const phase = phaseToRun(task.status);
  if (!phase) return task;

  // Brainstorm approval gate: if artifacts are ready and we're waiting for
  // the user, do not re-dispatch. The user's approve/request-changes action
  // is what advances the state.
  if (phase === "brainstorm" && task.awaitingApproval) return task;

  // Worktree-first invariant: every phase runs inside the task's worktree.
  // Branch + worktree are created on first dispatch and reused thereafter.
  const branch = task.branchName ?? branchNameFor(task.id);
  const worktree = await worktrees.ensure(task.id, branch);
  if (task.worktreePath !== worktree.path || task.branchName !== branch) {
    task = await runs.updateTask(task.id, {
      worktreePath: worktree.path,
      branchName: branch,
    });
  }

  // Brainstorm-specific: lay down design.md / spec.md scaffolding + initial
  // commit on the task branch. Idempotent — no-op on subsequent dispatches.
  if (phase === "brainstorm") {
    await scaffoldBrainstorm({ cwd: worktree.path, taskId: task.id, branch });
  }

  // Brainstorm runs span many ticks (one per user answer). Reuse a single Run
  // row across them so the dashboard's SSE subscription, opened on the first
  // render, keeps receiving events as the agent advances. Other phases keep
  // one-Run-per-dispatch semantics.
  let run: Run;
  if (phase === "brainstorm") {
    const existing = await runs.findActiveRun(task.id, phase);
    if (existing) {
      run = existing;
    } else {
      run = await runs.createRun({ taskId: task.id, phase });
    }
  } else {
    run = await runs.createRun({ taskId: task.id, phase });
  }

  const result = await runPhase(
    phase,
    {
      taskId: task.id,
      runId: run.id,
      ticketTitle: task.title,
      ticketDescription: task.description,
      ...(task.branchName ? { branch: task.branchName } : {}),
    },
    { ...phaseDeps, cwd: worktree.path },
  );

  // Brainstorm-specific gate: a successful tick doesn't mean "phase complete".
  // The agent halts on every unanswered question; only when both artifacts
  // reach `status: ready` is the brainstorm done. Mid-Q&A ticks keep the run
  // in `running`; cost/tokens accumulate across ticks.
  let brainstormBothReady = false;
  if (phase === "brainstorm" && result.ok) {
    const [design, spec] = await Promise.all([
      phaseDeps.store.readArtifact(worktree.path, task.id, "design"),
      phaseDeps.store.readArtifact(worktree.path, task.id, "spec"),
    ]);
    brainstormBothReady = design?.fm.status === "ready" && spec?.fm.status === "ready";
  }

  if (phase === "brainstorm") {
    // Accumulate cost/tokens across ticks instead of overwriting.
    const tickStatus = result.ok
      ? brainstormBothReady
        ? "succeeded"
        : "running"
      : "failed";
    await runs.updateRun(run.id, {
      ...(tickStatus !== "running" ? { endedAt: new Date() } : {}),
      status: tickStatus,
      error: result.error ?? null,
      inputTokens: run.inputTokens + result.inputTokens,
      outputTokens: run.outputTokens + result.outputTokens,
      costUsd: run.costUsd + result.costUsd,
    });
    if (result.ok && !brainstormBothReady) {
      // Still mid-Q&A. No state-machine transition. The next user answer
      // re-enters the loop with this same run.
      return task;
    }
  } else {
    await runs.updateRun(run.id, {
      endedAt: new Date(),
      status: result.ok ? "succeeded" : "failed",
      error: result.error ?? null,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
    });
  }

  const nextResult = transition(
    task,
    result.ok
      ? { type: "agent_phase_succeeded", phase }
      : { type: "agent_phase_failed", phase, retryCap },
  );

  if (!nextResult.ok) {
    // Should never happen if state-machine and run-loop agree on shape.
    await events.append({
      id: crypto.randomUUID(),
      runId: run.id,
      taskId: task.id,
      ts: new Date(),
      kind: "log",
      level: "error",
      text: `state machine refused transition: ${nextResult.error.message}`,
    });
    return task;
  }

  task = await runs.updateTask(task.id, {
    status: nextResult.task.status,
    retryCount: nextResult.task.retryCount,
    awaitingApproval: nextResult.task.awaitingApproval,
  });

  if (result.branch) {
    task = await runs.updateTask(task.id, { branchName: result.branch });
  }

  return task;
}
