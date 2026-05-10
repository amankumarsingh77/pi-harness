import { join } from "node:path";
import { mergePhaseModels, STATUS_TO_PHASE, type Phase, type Run, type Task } from "@pi-harness/shared";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { WorktreeManager, WorktreeInfo } from "../adapters/worktree.js";
import { transition } from "../domain/state-machine.js";
import { phasesFor } from "../domain/phase-chain.js";
import { runPhase, type PhaseDeps, type PhaseInput, type PhaseOutput } from "./phase-prompts.js";
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

  const phase = STATUS_TO_PHASE[task.status];
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

  if (phase === "brainstorm") {
    return dispatchBrainstorm({ task, branch, worktree, runs, events, phaseDeps, retryCap });
  }
  return dispatchGenericPhase({ task, phase, worktree, runs, events, phaseDeps, retryCap });
}

type DispatchOpts = {
  task: Task;
  worktree: WorktreeInfo;
  runs: RunStore;
  events: EventStore;
  phaseDeps: PhaseDeps;
  retryCap: number;
};

// Brainstorm has shape no other phase has: it scaffolds artifacts on first
// entry, reuses one Run row across many ticks (one per user answer), feeds
// the agent a session path + merged model config, and sits in `running`
// until both artifacts reach `status: ready`. Keeping all of that in one
// function localizes the asymmetry — the rest of run-loop stays generic.
async function dispatchBrainstorm(
  opts: DispatchOpts & { branch: string },
): Promise<Task> {
  const { runs, events, phaseDeps, worktree, retryCap, branch } = opts;
  let task = opts.task;

  // Lay down design.md / spec.md scaffolding + initial commit. Idempotent.
  await scaffoldBrainstorm({ cwd: worktree.path, taskId: task.id, branch });

  // Reuse a single Run across ticks so the dashboard's SSE subscription,
  // opened on the first render, keeps receiving events as the agent advances.
  let run: Run = (await runs.findActiveRun(task.id, "brainstorm"))
    ?? (await runs.createRun({ taskId: task.id, phase: "brainstorm" }));

  const phaseModel = mergePhaseModels(task.phaseModels, "brainstorm");
  const sessionPath = join(worktree.path, ".harness", task.id, "pi-session.jsonl");
  if (run.piSessionPath !== sessionPath) {
    run = await runs.updateRun(run.id, { piSessionPath: sessionPath });
  }

  const phaseInput: PhaseInput = {
    taskId: task.id,
    runId: run.id,
    ticketTitle: task.title,
    ticketDescription: task.description,
    ...(task.branchName ? { branch: task.branchName } : {}),
    phaseModel,
    sessionPath,
  };

  const result = await runPhase("brainstorm", phaseInput, { ...phaseDeps, cwd: worktree.path });

  // Brainstorm gate: success only counts when both artifacts hit `status: ready`.
  let bothReady = false;
  if (result.ok) {
    const [design, spec] = await Promise.all([
      phaseDeps.store.readArtifact(worktree.path, task.id, "design"),
      phaseDeps.store.readArtifact(worktree.path, task.id, "spec"),
    ]);
    bothReady = design?.fm.status === "ready" && spec?.fm.status === "ready";
  }

  // Accumulate cost/tokens across ticks instead of overwriting.
  const tickStatus = result.ok ? (bothReady ? "succeeded" : "running") : "failed";
  await runs.updateRun(run.id, {
    ...(tickStatus !== "running" ? { endedAt: new Date() } : {}),
    status: tickStatus,
    error: result.error ?? null,
    inputTokens: run.inputTokens + result.inputTokens,
    outputTokens: run.outputTokens + result.outputTokens,
    costUsd: run.costUsd + result.costUsd,
  });

  if (result.ok && !bothReady) {
    // Mid-Q&A. No state-machine transition; the next user answer re-enters.
    return task;
  }

  return applyTransition({ task, runs, events, runId: run.id, phase: "brainstorm", result, retryCap });
}

async function dispatchGenericPhase(
  opts: DispatchOpts & { phase: Phase },
): Promise<Task> {
  const { task, phase, worktree, runs, events, phaseDeps, retryCap } = opts;

  const run = await runs.createRun({ taskId: task.id, phase });
  const phaseInput: PhaseInput = {
    taskId: task.id,
    runId: run.id,
    ticketTitle: task.title,
    ticketDescription: task.description,
    ...(task.branchName ? { branch: task.branchName } : {}),
  };

  const result = await runPhase(phase, phaseInput, { ...phaseDeps, cwd: worktree.path });

  await runs.updateRun(run.id, {
    endedAt: new Date(),
    status: result.ok ? "succeeded" : "failed",
    error: result.error ?? null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });

  return applyTransition({ task, runs, events, runId: run.id, phase, result, retryCap });
}

async function applyTransition(opts: {
  task: Task;
  runs: RunStore;
  events: EventStore;
  runId: string;
  phase: Phase;
  result: PhaseOutput;
  retryCap: number;
}): Promise<Task> {
  const { task, runs, events, runId, phase, result, retryCap } = opts;
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
      runId,
      taskId: task.id,
      ts: new Date(),
      kind: "log",
      level: "error",
      text: `state machine refused transition: ${nextResult.error.message}`,
    });
    return task;
  }

  let next = await runs.updateTask(task.id, {
    status: nextResult.task.status,
    retryCount: nextResult.task.retryCount,
    awaitingApproval: nextResult.task.awaitingApproval,
  });

  if (result.branch) {
    next = await runs.updateTask(task.id, { branchName: result.branch });
  }

  return next;
}
