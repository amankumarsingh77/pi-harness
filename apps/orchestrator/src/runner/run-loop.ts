import type { Phase, PhaseModelConfig, Run, Task } from "@pi-harness/shared";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { WorktreeManager } from "../adapters/worktree.js";
import { runPhase, type PhaseDeps, type PhaseInput, type PhaseOutput } from "./phase-prompts.js";
import type { CancellationRegistry } from "./cancellation.js";
import { TaskWorkflowService } from "../services/task-workflow-service.js";

export type RunLoopPreparedPhase =
  | { readonly kind: "idle"; readonly task: Task }
  | {
      readonly kind: "run";
      readonly task: Task;
      readonly phase: Phase;
      readonly run: Run;
      readonly worktreePath: string;
      readonly phaseModel: PhaseModelConfig;
      readonly sessionPath?: string;
    };

export type RunLoopWorkflow = {
  readonly prepareNextTick: (taskId: string) => Promise<RunLoopPreparedPhase>;
  readonly completePhaseRun: (opts: {
    readonly task: Task;
    readonly phase: Phase;
    readonly run: Run;
    readonly result: PhaseOutput;
  }) => Promise<Task>;
};

export type RunLoopOpts = {
  task: Task;
  runs: RunStore;
  events: EventStore;
  phaseDeps: PhaseDeps;
  worktrees: WorktreeManager;
  retryCap: number;
  cancellation: CancellationRegistry;
  enqueue?: (taskId: string) => void;
  workflow?: RunLoopWorkflow;
};

export async function runLoop(opts: RunLoopOpts): Promise<Task> {
  const workflow = opts.workflow ?? new TaskWorkflowService({
    runs: opts.runs,
    events: opts.events,
    artifacts: opts.phaseDeps.store,
    worktrees: opts.worktrees,
    phaseDeps: opts.phaseDeps,
    retryCap: opts.retryCap,
    cancellation: opts.cancellation,
    ...(opts.enqueue !== undefined ? { enqueue: opts.enqueue } : {}),
  });
  const prepared = await workflow.prepareNextTick(opts.task.id);
  if (prepared.kind === "idle") return prepared.task;

  const controller = opts.cancellation.register(prepared.task.id);
  const phaseInput: PhaseInput = {
    taskId: prepared.task.id,
    runId: prepared.run.id,
    ticketTitle: prepared.task.title,
    ticketDescription: prepared.task.description,
    ...(prepared.task.branchName ? { branch: prepared.task.branchName } : {}),
    phaseModel: prepared.phaseModel,
    ...(prepared.sessionPath ? { sessionPath: prepared.sessionPath } : {}),
    signal: controller.signal,
  };

  try {
    const result = await runPhase(prepared.phase, phaseInput, {
      ...opts.phaseDeps,
      cwd: prepared.worktreePath,
    });
    return workflow.completePhaseRun({
      task: prepared.task,
      phase: prepared.phase,
      run: prepared.run,
      result,
    });
  } finally {
    opts.cancellation.release(prepared.task.id, controller);
  }
}
