import { join } from "node:path";
import { mergePhaseModels, STATUS_TO_PHASE, type Phase, type Run, type Task } from "@pi-harness/shared";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { WorktreeManager, WorktreeInfo } from "../adapters/worktree.js";
import { transition } from "../domain/state-machine.js";
import { phasesFor } from "../domain/phase-chain.js";
import { runPhase, type PhaseDeps, type PhaseInput, type PhaseOutput } from "./phase-prompts.js";
import { scaffoldBrainstorm } from "./scaffold-brainstorm.js";
import { scaffoldPlan } from "./scaffold-plan.js";
import { deriveBrainstormGate } from "../agents/brainstorm-gate.js";
import { derivePlanGate } from "../agents/plan-gate.js";
import type { CancellationRegistry } from "./cancellation.js";

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
  cancellation: CancellationRegistry;
  // Optional: re-enqueue this task on the scheduler. Plan uses it to chain
  // preflight → planner across two ticks without waiting on a user action,
  // since the scheduler is otherwise event-driven (it only ticks on enqueue).
  enqueue?: (taskId: string) => void;
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
  const { runs, events, phaseDeps, worktrees, retryCap, cancellation } = opts;
  let task = opts.task;

  if (!task.workflow) return task;
  // Touch phasesFor to validate the workflow has a chain (throws otherwise).
  phasesFor(task.workflow);

  const phase = STATUS_TO_PHASE[task.status];
  if (!phase) return task;

  // Brainstorm approval gate: if artifacts are ready AND no revision was
  // filed since the last ready event, we're waiting on the user — do not
  // re-dispatch. The user's approve/request-changes action is what
  // advances the state. The gate is derived from filesystem facts (artifact
  // frontmatter + brainstorm.jsonl), not a stored boolean.
  if (phase === "brainstorm" && task.worktreePath) {
    const gate = await deriveBrainstormGate(task.worktreePath, task.id, phaseDeps.store);
    if (gate === "awaiting_user") return task;
  }

  // Same posture for plan: derived gate from plan.md/scenarios.yaml
  // frontmatter + plan.jsonl ordering. When awaiting_user, the user's
  // approve/request-changes click is the only thing that advances state.
  if (phase === "plan" && task.worktreePath) {
    const gate = await derivePlanGate(task.worktreePath, task.id, phaseDeps.store);
    if (gate === "awaiting_user") return task;
  }

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
    return dispatchBrainstorm({ task, branch, worktree, runs, events, phaseDeps, retryCap, cancellation });
  }
  if (phase === "plan") {
    return dispatchPlan({
      task, branch, worktree, runs, events, phaseDeps, retryCap, cancellation,
      ...(opts.enqueue ? { enqueue: opts.enqueue } : {}),
    });
  }
  return dispatchGenericPhase({ task, phase, worktree, runs, events, phaseDeps, retryCap, cancellation });
}

type DispatchOpts = {
  task: Task;
  worktree: WorktreeInfo;
  runs: RunStore;
  events: EventStore;
  phaseDeps: PhaseDeps;
  retryCap: number;
  cancellation: CancellationRegistry;
};

// Brainstorm has shape no other phase has: it scaffolds artifacts on first
// entry, reuses one Run row across many ticks (one per user answer), feeds
// the agent a session path + merged model config, and sits in `running`
// until both artifacts reach `status: ready`. Keeping all of that in one
// function localizes the asymmetry — the rest of run-loop stays generic.
async function dispatchBrainstorm(
  opts: DispatchOpts & { branch: string },
): Promise<Task> {
  const { runs, events, phaseDeps, worktree, retryCap, branch, cancellation } = opts;
  let task = opts.task;

  // Lay down design.md / spec.md scaffolding + initial commit. Idempotent.
  await scaffoldBrainstorm({ cwd: worktree.path, taskId: task.id, branch });

  // Reuse a single Run across ticks so the dashboard's SSE subscription,
  // opened on the first render, keeps receiving events as the agent advances.
  const existingRun = await runs.findActiveRun(task.id, "brainstorm");
  let run: Run = existingRun ?? (await runs.createRun({ taskId: task.id, phase: "brainstorm" }));
  if (!existingRun) {
    await events.append({
      id: crypto.randomUUID(),
      runId: run.id,
      taskId: task.id,
      ts: new Date(),
      kind: "phase_started",
      phase: "brainstorm",
    });
  }

  const phaseModel = mergePhaseModels(task.phaseModels, "brainstorm");
  const sessionPath = join(worktree.path, ".harness", task.id, "pi-session.jsonl");
  if (run.piSessionPath !== sessionPath) {
    run = await runs.updateRun(run.id, { piSessionPath: sessionPath });
  }

  const controller = cancellation.register(task.id);
  const phaseInput: PhaseInput = {
    taskId: task.id,
    runId: run.id,
    ticketTitle: task.title,
    ticketDescription: task.description,
    ...(task.branchName ? { branch: task.branchName } : {}),
    phaseModel,
    sessionPath,
    signal: controller.signal,
  };

  let result: PhaseOutput;
  try {
    result = await runPhase("brainstorm", phaseInput, { ...phaseDeps, cwd: worktree.path });
  } finally {
    cancellation.release(task.id, controller);
  }

  // The route handler that processed user_cancel already settled the run and
  // emitted phase_ended cancelled. Don't double-write status or events.
  if (result.cancelled) return task;

  // Brainstorm runs intentionally stay `running` across all ticks. The phase
  // ends only when the user approves (handled in routes/tasks.ts
  // user_approve_brainstorm) or when a tick itself fails. This keeps a single
  // runId alive so the dashboard's SSE subscription survives a request-changes
  // round-trip without losing the transcript.
  await runs.updateRun(run.id, {
    ...(result.ok ? {} : { endedAt: new Date() }),
    status: result.ok ? "running" : "failed",
    error: result.error ?? null,
    inputTokens: run.inputTokens + result.inputTokens,
    outputTokens: run.outputTokens + result.outputTokens,
    costUsd: run.costUsd + result.costUsd,
  });

  if (result.ok) return task;

  await events.append({
    id: crypto.randomUUID(),
    runId: run.id,
    taskId: task.id,
    ts: new Date(),
    kind: "phase_ended",
    phase: "brainstorm",
    status: "failed",
  });

  return applyTransition({ task, runs, events, runId: run.id, phase: "brainstorm", result, retryCap });
}

// Plan mirrors brainstorm's asymmetric shape: scaffold artifacts on first
// entry, reuse one Run row across multiple ticks (preflight tick + planner
// tick + revision ticks), and stay `running` until the user approves. The
// session JSONL is namespaced (pi-session-plan.jsonl) so a future code phase
// can claim its own pi-session-code.jsonl without colliding.
async function dispatchPlan(
  opts: DispatchOpts & { branch: string; enqueue?: (taskId: string) => void },
): Promise<Task> {
  const { runs, events, phaseDeps, worktree, retryCap, branch, cancellation } = opts;
  let task = opts.task;

  await scaffoldPlan({ cwd: worktree.path, taskId: task.id, branch });

  const existingRun = await runs.findActiveRun(task.id, "plan");
  let run: Run = existingRun ?? (await runs.createRun({ taskId: task.id, phase: "plan" }));
  if (!existingRun) {
    await events.append({
      id: crypto.randomUUID(),
      runId: run.id,
      taskId: task.id,
      ts: new Date(),
      kind: "phase_started",
      phase: "plan",
    });
  }

  const phaseModel = mergePhaseModels(task.phaseModels, "plan");
  const sessionPath = join(worktree.path, ".harness", task.id, "pi-session-plan.jsonl");
  if (run.piSessionPath !== sessionPath) {
    run = await runs.updateRun(run.id, { piSessionPath: sessionPath });
  }

  const controller = cancellation.register(task.id);
  const phaseInput: PhaseInput = {
    taskId: task.id,
    runId: run.id,
    ticketTitle: task.title,
    ticketDescription: task.description,
    ...(task.branchName ? { branch: task.branchName } : {}),
    phaseModel,
    sessionPath,
    signal: controller.signal,
  };

  let result: PhaseOutput;
  try {
    result = await runPhase("plan", phaseInput, { ...phaseDeps, cwd: worktree.path });
  } finally {
    cancellation.release(task.id, controller);
  }

  if (result.cancelled) return task;

  await runs.updateRun(run.id, {
    ...(result.ok ? {} : { endedAt: new Date() }),
    status: result.ok ? "running" : "failed",
    error: result.error ?? null,
    inputTokens: run.inputTokens + result.inputTokens,
    outputTokens: run.outputTokens + result.outputTokens,
    costUsd: run.costUsd + result.costUsd,
  });

  if (result.ok) {
    // Plan is multi-tick (preflight, then planner, then optional revisions).
    // The scheduler is event-driven — without an enqueue, a successful tick
    // that hasn't yet flipped artifacts to ready would just stall waiting for
    // a user action that isn't required. Re-enqueue so the next tick fires.
    // Skipped when artifacts are already ready (the gate check at the top of
    // runLoop will short-circuit on the next tick anyway, so it's harmless,
    // but no point burning a tick).
    const [plan, scenarios] = await Promise.all([
      phaseDeps.store.readArtifact(worktree.path, task.id, "plan"),
      phaseDeps.store.readArtifact(worktree.path, task.id, "scenarios"),
    ]);
    const ready =
      plan?.fm.status === "ready" && scenarios?.fm.status === "ready";
    if (!ready && opts.enqueue) opts.enqueue(task.id);
    return task;
  }

  await events.append({
    id: crypto.randomUUID(),
    runId: run.id,
    taskId: task.id,
    ts: new Date(),
    kind: "phase_ended",
    phase: "plan",
    status: "failed",
  });

  return applyTransition({ task, runs, events, runId: run.id, phase: "plan", result, retryCap });
}

async function dispatchGenericPhase(
  opts: DispatchOpts & { phase: Phase },
): Promise<Task> {
  const { task, phase, worktree, runs, events, phaseDeps, retryCap } = opts;

  const run = await runs.createRun({ taskId: task.id, phase });
  await events.append({
    id: crypto.randomUUID(),
    runId: run.id,
    taskId: task.id,
    ts: new Date(),
    kind: "phase_started",
    phase,
  });

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

  await events.append({
    id: crypto.randomUUID(),
    runId: run.id,
    taskId: task.id,
    ts: new Date(),
    kind: "phase_ended",
    phase,
    status: result.ok ? "succeeded" : "failed",
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
  });

  if (result.branch) {
    next = await runs.updateTask(task.id, { branchName: result.branch });
  }

  return next;
}
