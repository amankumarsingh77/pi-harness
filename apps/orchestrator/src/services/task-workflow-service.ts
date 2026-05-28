import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  cancelablePhaseForTaskStatus,
  mergePhaseModels,
  phaseForTaskStatus,
  type Phase,
  type PhaseModelConfig,
  type Run,
  type Task,
  type TaskPriority,
} from "@pi-harness/shared";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import type { MissionStore } from "../adapters/mission-store.js";
import {
  PhaseEventLogStore,
  type BrainstormPhaseEventInput,
  type PlanPhaseEventInput,
} from "../adapters/phase-event-log-store.js";
import { readJsonl } from "../adapters/jsonl-writer.js";
import { deriveBrainstormGate } from "../agents/brainstorm-gate.js";
import { derivePlanGate } from "../agents/plan-gate.js";
import type { TaskScheduler } from "../runner/scheduler.js";
import type { CancellationRegistry } from "../runner/cancellation.js";
import type { TaskMutationLock } from "../runner/task-mutation-lock.js";
import type { WorktreeInfo, WorktreeManager } from "../adapters/worktree.js";
import { phasesFor } from "../domain/phase-chain.js";
import { transition, type TransitionAction } from "../domain/state-machine.js";
import { InvalidTransitionError, WorkflowConflictError, WorkflowHttpError } from "../domain/errors.js";
import { scaffoldBrainstorm } from "../runner/scaffold-brainstorm.js";
import { scaffoldPlan } from "../runner/scaffold-plan.js";
import type { PhaseDeps, PhaseOutput } from "../runner/phase-prompts.js";
import type { GraphifyLifecycle } from "../agents/graphify-manager.js";

type SchedulerHandle = Pick<TaskScheduler, "enqueue" | "cancelAndDrain">;

type TaskPatch = {
  readonly title?: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
  readonly tags?: readonly string[];
  readonly phaseModels?: Partial<Record<Phase, PhaseModelPatch>>;
};

type PhaseModelPatch = {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly thinkingLevel?: PhaseModelConfig["thinkingLevel"] | undefined;
  readonly maxTurns?: number | undefined;
};

type CreateTaskInput = {
  readonly title: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
  readonly tags?: readonly string[];
};

export type PreparedPhase =
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

type TaskWorkflowServiceDeps = {
  readonly runs: RunStore;
  readonly events: EventStore;
  readonly artifacts: ArtifactsStore;
  readonly missionStore?: MissionStore;
  readonly mutationLock?: TaskMutationLock;
  readonly scheduler?: SchedulerHandle;
  readonly cancellation?: CancellationRegistry;
  readonly worktrees?: WorktreeManager;
  readonly phaseDeps?: PhaseDeps;
  readonly retryCap?: number;
  readonly graphify?: GraphifyLifecycle;
  readonly enqueue?: (taskId: string) => void;
};

type BrainstormAnswerInput = {
  readonly questionId: string;
  readonly optionId?: string | undefined;
  readonly optionIds?: readonly string[] | undefined;
  readonly freeText?: string | undefined;
};

type BrainstormJsonlEvent = Record<string, unknown> & { readonly kind?: string };

export class TaskWorkflowService {
  private scheduler: SchedulerHandle | undefined;
  private readonly phaseEvents: PhaseEventLogStore;

  constructor(private readonly deps: TaskWorkflowServiceDeps) {
    this.scheduler = deps.scheduler;
    this.phaseEvents = new PhaseEventLogStore({ events: deps.events, runs: deps.runs });
  }

  setScheduler(scheduler: SchedulerHandle): void {
    this.scheduler = scheduler;
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    const task = await this.deps.runs.createTask(input);
    await this.deps.missionStore?.ensureMission(task);
    return task;
  }

  async updateTaskMetadata(taskId: string, patch: TaskPatch): Promise<Task> {
    return this.runExclusive(taskId, async () => {
      const task = await this.deps.runs.getTask(taskId);
      if (patch.phaseModels !== undefined && (await this.deps.runs.hasAnyRun(task.id))) {
        throw new WorkflowHttpError(
          "phase_models_frozen",
          409,
          "Cannot modify phaseModels after the task has started its first run.",
        );
      }
      const phaseModels =
        patch.phaseModels !== undefined ? normalizePhaseModelPatch(patch.phaseModels) : undefined;
      return this.deps.runs.updateTask(task.id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(phaseModels !== undefined ? { phaseModels } : {}),
      });
    });
  }

  async applyUserTransition(
    taskId: string,
    action: Extract<TransitionAction, { readonly type: `user_${string}` }>,
  ): Promise<{ readonly task: Task }> {
    return this.runExclusive(taskId, async () => {
      const task = await this.deps.runs.getTask(taskId);
      await this.assertGateOpen(task, action);
      const result = transition(task, action);
      if (!result.ok) throw result.error;

      const shouldEnqueue = await this.applyUserTransitionSideEffects(task, action);
      const updated = await this.deps.runs.updateTask(task.id, {
        status: result.task.status,
        workflow: result.task.workflow,
        retryCount: result.task.retryCount,
      });
      if (shouldEnqueue) this.enqueue(task.id);
      return { task: updated };
    });
  }

  async submitBrainstormAnswers(
    taskId: string,
    answers: readonly BrainstormAnswerInput[],
  ): Promise<{ readonly ok: true; readonly count: number }> {
    return this.runExclusive(taskId, async () => {
      const task = await this.taskWithWorktree(taskId);
      await this.phaseEvents.publishMany({
        phase: "brainstorm",
        worktreePath: task.worktreePath,
        taskId: task.id,
        timestamp: new Date(),
        inputs: answers.map((answer): BrainstormPhaseEventInput => ({
          kind: "brainstorm_answer",
          questionId: answer.questionId,
          ...(answer.optionId !== undefined ? { optionId: answer.optionId } : {}),
          ...(answer.optionIds !== undefined ? { optionIds: [...answer.optionIds] } : {}),
          ...(answer.freeText !== undefined ? { freeText: answer.freeText } : {}),
        })),
      });
      this.enqueue(task.id);
      return { ok: true, count: answers.length };
    });
  }

  async submitBrainstormNudge(
    taskId: string,
    comment: string,
  ): Promise<{ readonly ok: true; readonly nudgeId: string }> {
    return this.runExclusive(taskId, async () => {
      const task = await this.taskWithWorktree(taskId);
      const gate = await deriveBrainstormGate(task.worktreePath, task.id, this.deps.artifacts);
      if (gate === "awaiting_user") {
        throw new WorkflowConflictError(
          "gate_closed",
          "brainstorm artifacts are ready and awaiting your approval — request changes instead of nudging",
        );
      }
      const nudgeId = `n_${randomUUID()}`;
      await this.phaseEvents.publish({
        phase: "brainstorm",
        worktreePath: task.worktreePath,
        taskId: task.id,
        input: {
          kind: "brainstorm_user_nudge",
          nudgeId,
          comment,
          consumed: false,
        },
      });
      this.enqueue(task.id);
      return { ok: true, nudgeId };
    });
  }

  async editBrainstormArtifact(opts: {
    readonly taskId: string;
    readonly kind: "design" | "spec";
    readonly body: string;
  }): Promise<{ readonly ok: true; readonly commitSha: string; readonly artifactRevisionId: string }> {
    return this.runExclusive(opts.taskId, async () => {
      const task = await this.taskInStatusWithWorktree(opts.taskId, "brainstorming");
      const prior = await this.deps.artifacts.readArtifact(task.worktreePath, task.id, opts.kind);
      const sizeDelta = opts.body.length - (prior?.body.length ?? 0);
      const { commitSha, artifactRevisionId } = await this.deps.artifacts.applyHumanEdit(
        task.worktreePath,
        task.id,
        opts.kind,
        opts.body,
      );
      await this.phaseEvents.publish({
        phase: "brainstorm",
        worktreePath: task.worktreePath,
        taskId: task.id,
        input: {
          kind: "brainstorm_artifact_edited",
          artifact: opts.kind,
          commitSha,
          artifactRevisionId,
          sizeDelta,
        },
      });
      this.enqueue(task.id);
      return { ok: true, commitSha, artifactRevisionId };
    });
  }

  async requestBrainstormMockEdit(opts: {
    readonly taskId: string;
    readonly mockId: string;
    readonly comment: string;
  }): Promise<{ readonly ok: true; readonly requestId: string }> {
    return this.runExclusive(opts.taskId, async () => {
      const task = await this.taskInStatusWithWorktree(opts.taskId, "brainstorming");
      const [manifest, events] = await Promise.all([
        this.deps.artifacts.readBrainstormMockManifest(task.worktreePath, task.id),
        this.readBrainstormEvents(task),
      ]);
      if (!manifest.mocks.some((mock) => mock.mockId === opts.mockId)) {
        throw new WorkflowHttpError("mock_not_found", 404, `mock ${opts.mockId} not found`);
      }
      this.assertMockActionUnlocked(events, opts.mockId);
      const requestId = `mer_${randomUUID()}`;
      await this.phaseEvents.publish({
        phase: "brainstorm",
        worktreePath: task.worktreePath,
        taskId: task.id,
        input: {
          kind: "brainstorm_mock_edit_requested",
          requestId,
          mockId: opts.mockId,
          comment: opts.comment,
        },
      });
      this.enqueue(task.id);
      return { ok: true, requestId };
    });
  }

  async selectBrainstormMock(
    taskId: string,
    mockId: string,
  ): Promise<{ readonly ok: true; readonly mockId: string }> {
    return this.runExclusive(taskId, async () => {
      const task = await this.taskInStatusWithWorktree(taskId, "brainstorming");
      this.assertMockActionUnlocked(await this.readBrainstormEvents(task), mockId);
      try {
        await this.deps.artifacts.selectBrainstormMock(task.worktreePath, task.id, mockId);
      } catch {
        throw new WorkflowHttpError("mock_not_found", 404, `mock ${mockId} not found`);
      }
      await this.phaseEvents.publish({
        phase: "brainstorm",
        worktreePath: task.worktreePath,
        taskId: task.id,
        input: {
          kind: "brainstorm_mock_selected",
          mockId,
        },
      });
      this.enqueue(task.id);
      return { ok: true, mockId };
    });
  }

  async restartBrainstorm(
    taskId: string,
    note?: string,
  ): Promise<{ readonly ok: true; readonly archivedRunId: string | null; readonly newRunId: string }> {
    return this.runExclusive(taskId, async () => {
      const task = await this.taskInStatusWithWorktree(taskId, "brainstorming");
      await this.cancelAndDrain(task.id);
      const restartRun =
        (await this.deps.runs.findActiveRun(task.id, "brainstorm")) ??
        (await this.deps.runs.findLatestRun(task.id, "brainstorm", "cancelled"));
      if (restartRun && restartRun.status !== "cancelled") {
        await this.deps.runs.updateRun(restartRun.id, {
          status: "cancelled",
          endedAt: new Date(),
        });
      }
      if (restartRun) {
        await this.deps.artifacts.archiveCurrentRun(task.worktreePath, task.id, restartRun.id, "brainstorm");
      }
      await scaffoldBrainstorm({
        cwd: task.worktreePath,
        taskId: task.id,
        branch: task.branchName ?? `pi/${task.id}`,
        store: this.deps.artifacts,
      });
      const newRun = await this.deps.runs.createRun({ taskId: task.id, phase: "brainstorm" });
      const trimmed = note?.trim();
      const inputs: BrainstormPhaseEventInput[] = [
        ...(trimmed
          ? [{
              kind: "brainstorm_user_nudge" as const,
              nudgeId: `n_${randomUUID()}`,
              comment: trimmed,
              consumed: false,
            }]
          : []),
        {
          kind: "brainstorm_system",
          systemKind: "session_reset",
          data: {
            archivedRunId: restartRun?.id ?? null,
            ...(trimmed ? { note: trimmed } : {}),
          },
        },
      ];
      await this.phaseEvents.publishMany({
        phase: "brainstorm",
        worktreePath: task.worktreePath,
        taskId: task.id,
        runId: newRun.id,
        inputs,
      });
      this.enqueue(task.id);
      return { ok: true, archivedRunId: restartRun?.id ?? null, newRunId: newRun.id };
    });
  }

  async editPlanArtifact(opts: {
    readonly taskId: string;
    readonly kind: "plan";
    readonly body: string;
  }): Promise<{ readonly ok: true; readonly commitSha: string; readonly artifactRevisionId: string }> {
    return this.runExclusive(opts.taskId, async () => {
      const task = await this.taskInStatusWithWorktree(opts.taskId, "planning");
      const prior = await this.deps.artifacts.readArtifact(task.worktreePath, task.id, opts.kind);
      const sizeDelta = opts.body.length - (prior?.body.length ?? 0);
      const { commitSha, artifactRevisionId } = await this.deps.artifacts.applyHumanEdit(
        task.worktreePath,
        task.id,
        opts.kind,
        opts.body,
      );
      await this.phaseEvents.publish({
        phase: "plan",
        worktreePath: task.worktreePath,
        taskId: task.id,
        input: {
          kind: "plan_artifact_edited",
          artifact: opts.kind,
          commitSha,
          artifactRevisionId,
          sizeDelta,
        },
      });
      this.enqueue(task.id);
      return { ok: true, commitSha, artifactRevisionId };
    });
  }

  async restartPlan(
    taskId: string,
    note?: string,
  ): Promise<{ readonly ok: true; readonly archivedRunId: string; readonly newRunId: string }> {
    return this.runExclusive(taskId, async () => {
      const task = await this.taskInStatusWithWorktree(taskId, "planning");
      await this.cancelAndDrain(task.id);
      const restartRun =
        (await this.deps.runs.findActiveRun(task.id, "plan")) ??
        (await this.deps.runs.findLatestRun(task.id, "plan", "cancelled"));
      if (!restartRun) {
        throw new WorkflowConflictError("no_active_run", "no active or cancelled plan run to restart");
      }
      if (restartRun.status !== "cancelled") {
        await this.deps.runs.updateRun(restartRun.id, {
          status: "cancelled",
          endedAt: new Date(),
        });
      }
      await this.deps.artifacts.archiveCurrentRun(task.worktreePath, task.id, restartRun.id, "plan");
      await scaffoldPlan({
        cwd: task.worktreePath,
        taskId: task.id,
        branch: task.branchName ?? `pi/${task.id}`,
        store: this.deps.artifacts,
      });
      const newRun = await this.deps.runs.createRun({ taskId: task.id, phase: "plan" });
      const trimmed = note?.trim();
      await this.phaseEvents.publishMany({
        phase: "plan",
        worktreePath: task.worktreePath,
        taskId: task.id,
        runId: newRun.id,
        inputs: [{
          kind: "plan_system",
          systemKind: "session_reset",
          data: {
            archivedRunId: restartRun.id,
            ...(trimmed ? { note: trimmed } : {}),
          },
        }],
      });
      this.enqueue(task.id);
      return { ok: true, archivedRunId: restartRun.id, newRunId: newRun.id };
    });
  }

  async prepareNextTick(taskId: string): Promise<PreparedPhase> {
    const task = await this.deps.runs.getTask(taskId);
    if (!task.workflow) return { kind: "idle", task };
    phasesFor(task.workflow);

    const phase = phaseForTaskStatus(task.status);
    if (!phase) return { kind: "idle", task };
    if (await this.isPausedByCancellation(task.id, phase)) return { kind: "idle", task };
    if (await this.isAwaitingGate(task, phase)) return { kind: "idle", task };

    const worktree = await this.ensureWorktree(task);
    const updatedTask = await this.persistWorktree(task, worktree);
    this.warmGraphify(worktree.path);

    if (phase === "brainstorm") {
      return this.prepareBrainstorm(updatedTask, worktree);
    }
    if (phase === "plan") {
      return this.preparePlan(updatedTask, worktree);
    }
    return this.prepareGenericPhase(updatedTask, phase, worktree);
  }

  async completePhaseRun(opts: {
    readonly task: Task;
    readonly phase: Phase;
    readonly run: Run;
    readonly result: PhaseOutput;
  }): Promise<Task> {
    if (opts.result.cancelled) return opts.task;
    if (opts.phase === "brainstorm") return this.completeLongRunningPhase(opts, "brainstorm");
    if (opts.phase === "plan") return this.completeLongRunningPhase(opts, "plan");
    return this.completeGenericPhase(opts);
  }

  async recoverRunnableTasks(): Promise<number> {
    const tasks = await this.deps.runs.listTasks();
    const active = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
    const shouldEnqueue = await Promise.all(
      active.map(async (task) => ({
        task,
        enqueue: !(await this.isTaskAwaitingUser(task)),
      })),
    );
    for (const item of shouldEnqueue) {
      if (item.enqueue) this.enqueue(item.task.id);
    }
    return active.length;
  }

  private async applyUserTransitionSideEffects(
    task: Task,
    action: Extract<TransitionAction, { readonly type: `user_${string}` }>,
  ): Promise<boolean> {
    if (action.type === "user_request_brainstorm_changes") {
      await this.requestBrainstormChanges(task, action.comment);
    }
    if (action.type === "user_request_plan_changes") {
      await this.requestPlanChanges(task, action.comment);
    }
    if (action.type === "user_cancel") {
      await this.cancelTask(task);
    }
    if (action.type === "user_cancel_current_phase") {
      await this.cancelCurrentPhase(task);
      return false;
    }
    if (action.type === "user_approve_brainstorm") {
      await this.settleActiveRun(task, "brainstorm", "succeeded");
    }
    if (action.type === "user_approve_plan") {
      await this.settleActiveRun(task, "plan", "succeeded");
    }
    return true;
  }

  private async assertGateOpen(
    task: Task,
    action: Extract<TransitionAction, { readonly type: `user_${string}` }>,
  ): Promise<void> {
    if (
      action.type === "user_approve_brainstorm" ||
      action.type === "user_request_brainstorm_changes"
    ) {
      const withWorktree = this.requireWorktree(task);
      const gate = await deriveBrainstormGate(withWorktree.worktreePath, task.id, this.deps.artifacts);
      if (gate !== "awaiting_user") {
        throw new WorkflowConflictError("gate_closed", "brainstorm is not awaiting approval");
      }
    }
    if (action.type === "user_approve_plan" || action.type === "user_request_plan_changes") {
      const withWorktree = this.requireWorktree(task);
      const gate = await derivePlanGate(withWorktree.worktreePath, task.id, this.deps.artifacts);
      if (gate !== "awaiting_user") {
        throw new WorkflowConflictError("gate_closed", "plan is not awaiting approval");
      }
    }
  }

  private async requestBrainstormChanges(task: Task, comment: string): Promise<void> {
    const { worktreePath } = this.requireWorktree(task);
    await this.phaseEvents.publish({
      phase: "brainstorm",
      worktreePath,
      taskId: task.id,
      input: {
        kind: "brainstorm_revision_requested",
        comment,
      },
    });
    await this.deps.artifacts.setArtifactStatus(worktreePath, task.id, "design", "draft", "user-revision");
    await this.deps.artifacts.setArtifactStatus(worktreePath, task.id, "spec", "draft", "user-revision");
  }

  private async requestPlanChanges(task: Task, comment: string): Promise<void> {
    const { worktreePath } = this.requireWorktree(task);
    await this.phaseEvents.publish({
      phase: "plan",
      worktreePath,
      taskId: task.id,
      input: {
        kind: "plan_revision_requested",
        comment,
      },
    });
    await this.deps.artifacts.setArtifactStatus(worktreePath, task.id, "plan", "draft", "user-revision");
    await this.deps.artifacts.setArtifactStatus(worktreePath, task.id, "scenarios", "draft", "user-revision");
    await this.deps.artifacts.setArtifactStatus(worktreePath, task.id, "blast-radius", "draft", "user-revision");
    await this.deps.artifacts.setArtifactStatus(worktreePath, task.id, "execution-dag", "draft", "user-revision");
  }

  private async cancelTask(task: Task): Promise<void> {
    this.deps.cancellation?.abort(task.id);
    const activeRuns = await this.deps.runs.findActiveRunsForTask(task.id);
    const ts = new Date();
    for (const run of activeRuns) {
      await this.deps.runs.updateRun(run.id, { status: "cancelled", endedAt: ts });
      await this.appendPhaseEnded(run, ts, "cancelled");
    }
  }

  private async cancelCurrentPhase(task: Task): Promise<void> {
    const phase = cancelablePhaseForTaskStatus(task.status);
    if (!phase) {
      throw new InvalidTransitionError(task.status, "?", "task must be in brainstorming or planning");
    }
    const activeRun = await this.deps.runs.findActiveRun(task.id, phase);
    if (!activeRun) {
      throw new WorkflowConflictError("no_active_run", `no active ${phase} run to cancel`);
    }
    await this.cancelAndDrain(task.id);
    const ts = new Date();
    await this.deps.runs.updateRun(activeRun.id, { status: "cancelled", endedAt: ts });
    await this.appendPhaseEnded(activeRun, ts, "cancelled");
  }

  private async settleActiveRun(
    task: Task,
    phase: Extract<Phase, "brainstorm" | "plan">,
    status: "succeeded",
  ): Promise<void> {
    const activeRun = await this.deps.runs.findActiveRun(task.id, phase);
    if (!activeRun) return;
    const ts = new Date();
    await this.deps.runs.updateRun(activeRun.id, { status, endedAt: ts });
    await this.appendPhaseEnded(activeRun, ts, status);
  }

  private async prepareBrainstorm(task: Task, worktree: WorktreeInfo): Promise<PreparedPhase> {
    await scaffoldBrainstorm({
      cwd: worktree.path,
      taskId: task.id,
      branch: task.branchName ?? branchNameFor(task.id),
      store: this.deps.artifacts,
    });
    const run = await this.openLongRunningRun(task, "brainstorm");
    const sessionPath = join(worktree.path, ".harness", task.id, "pi-session.jsonl");
    const updatedRun = run.piSessionPath === sessionPath
      ? run
      : await this.deps.runs.updateRun(run.id, { piSessionPath: sessionPath });
    return {
      kind: "run",
      task,
      phase: "brainstorm",
      run: updatedRun,
      worktreePath: worktree.path,
      phaseModel: mergePhaseModels(task.phaseModels, "brainstorm"),
      sessionPath,
    };
  }

  private async preparePlan(task: Task, worktree: WorktreeInfo): Promise<PreparedPhase> {
    await scaffoldPlan({
      cwd: worktree.path,
      taskId: task.id,
      branch: task.branchName ?? branchNameFor(task.id),
      store: this.deps.artifacts,
    });
    const run = await this.openLongRunningRun(task, "plan");
    const sessionPath = join(worktree.path, ".harness", task.id, "pi-session-plan.jsonl");
    const updatedRun = run.piSessionPath === sessionPath
      ? run
      : await this.deps.runs.updateRun(run.id, { piSessionPath: sessionPath });
    return {
      kind: "run",
      task,
      phase: "plan",
      run: updatedRun,
      worktreePath: worktree.path,
      phaseModel: mergePhaseModels(task.phaseModels, "plan"),
      sessionPath,
    };
  }

  private async prepareGenericPhase(
    task: Task,
    phase: Phase,
    worktree: WorktreeInfo,
  ): Promise<PreparedPhase> {
    const run = await this.deps.runs.createRun({ taskId: task.id, phase });
    await this.deps.events.append({
      id: randomUUID(),
      runId: run.id,
      taskId: task.id,
      ts: new Date(),
      kind: "phase_started",
      phase,
    });
    return {
      kind: "run",
      task,
      phase,
      run,
      worktreePath: worktree.path,
      phaseModel: mergePhaseModels(task.phaseModels, phase),
    };
  }

  private async openLongRunningRun(
    task: Task,
    phase: Extract<Phase, "brainstorm" | "plan">,
  ): Promise<Run> {
    const existingRun = await this.deps.runs.findActiveRun(task.id, phase);
    const run = existingRun ?? await this.deps.runs.createRun({ taskId: task.id, phase });
    if (!existingRun) {
      await this.deps.events.append({
        id: randomUUID(),
        runId: run.id,
        taskId: task.id,
        ts: new Date(),
        kind: "phase_started",
        phase,
      });
    }
    return run.status === "running" ? run : this.deps.runs.updateRun(run.id, { status: "running" });
  }

  private async completeLongRunningPhase(
    opts: {
      readonly task: Task;
      readonly phase: Phase;
      readonly run: Run;
      readonly result: PhaseOutput;
    },
    phase: Extract<Phase, "brainstorm" | "plan">,
  ): Promise<Task> {
    await this.deps.runs.updateRun(opts.run.id, {
      ...(opts.result.ok ? {} : { endedAt: new Date() }),
      status: opts.result.ok ? "running" : "failed",
      error: opts.result.error ?? null,
      inputTokens: opts.run.inputTokens + opts.result.inputTokens,
      outputTokens: opts.run.outputTokens + opts.result.outputTokens,
      costUsd: opts.run.costUsd + opts.result.costUsd,
    });
    if (opts.result.ok) {
      if (phase === "plan" && !(await this.planArtifactsReady(opts.task))) this.enqueue(opts.task.id);
      return opts.task;
    }
    await this.appendPhaseEnded(opts.run, new Date(), "failed");
    return this.applyAgentTransition(opts.task, opts.run.id, phase, opts.result);
  }

  private async completeGenericPhase(opts: {
    readonly task: Task;
    readonly phase: Phase;
    readonly run: Run;
    readonly result: PhaseOutput;
  }): Promise<Task> {
    await this.deps.runs.updateRun(opts.run.id, {
      endedAt: new Date(),
      status: opts.result.ok ? "succeeded" : "failed",
      error: opts.result.error ?? null,
      inputTokens: opts.result.inputTokens,
      outputTokens: opts.result.outputTokens,
      costUsd: opts.result.costUsd,
    });
    await this.appendPhaseEnded(opts.run, new Date(), opts.result.ok ? "succeeded" : "failed");
    return this.applyAgentTransition(opts.task, opts.run.id, opts.phase, opts.result);
  }

  private async applyAgentTransition(
    task: Task,
    runId: string,
    phase: Phase,
    result: PhaseOutput,
  ): Promise<Task> {
    const retryCap = this.deps.retryCap ?? 0;
    const nextResult = transition(
      task,
      result.ok
        ? { type: "agent_phase_succeeded", phase }
        : { type: "agent_phase_failed", phase, retryCap },
    );
    if (!nextResult.ok) {
      await this.deps.events.append({
        id: randomUUID(),
        runId,
        taskId: task.id,
        ts: new Date(),
        kind: "log",
        level: "error",
        text: `state machine refused transition: ${nextResult.error.message}`,
      });
      return task;
    }
    const next = await this.deps.runs.updateTask(task.id, {
      status: nextResult.task.status,
      retryCount: nextResult.task.retryCount,
    });
    if (result.branch) {
      return this.deps.runs.updateTask(task.id, { branchName: result.branch });
    }
    return next;
  }

  private async planArtifactsReady(task: Task): Promise<boolean> {
    const { worktreePath } = this.requireWorktree(task);
    const [plan, scenarios, blastRadius, executionDag] = await Promise.all([
      this.deps.artifacts.readArtifact(worktreePath, task.id, "plan"),
      this.deps.artifacts.readArtifact(worktreePath, task.id, "scenarios"),
      this.deps.artifacts.readArtifact(worktreePath, task.id, "blast-radius"),
      this.deps.artifacts.readArtifact(worktreePath, task.id, "execution-dag"),
    ]);
    return (
      plan?.fm.status === "ready" &&
      scenarios?.fm.status === "ready" &&
      blastRadius?.fm.status === "ready" &&
      executionDag?.fm.status === "ready"
    );
  }

  private async appendPhaseEnded(
    run: Pick<Run, "id" | "taskId" | "phase">,
    ts: Date,
    status: "succeeded" | "failed" | "cancelled",
  ): Promise<void> {
    await this.deps.events.append({
      id: randomUUID(),
      runId: run.id,
      taskId: run.taskId,
      ts,
      kind: "phase_ended",
      phase: run.phase,
      status,
    });
  }

  private async ensureWorktree(task: Task): Promise<WorktreeInfo> {
    if (!this.deps.worktrees) {
      throw new WorkflowConflictError("no_worktree", "workflow service has no worktree manager");
    }
    return this.deps.worktrees.ensure(task.id, task.branchName ?? branchNameFor(task.id));
  }

  private async persistWorktree(task: Task, worktree: WorktreeInfo): Promise<Task> {
    const branch = task.branchName ?? branchNameFor(task.id);
    if (task.worktreePath === worktree.path && task.branchName === branch) return task;
    return this.deps.runs.updateTask(task.id, {
      worktreePath: worktree.path,
      branchName: branch,
    });
  }

  private warmGraphify(cwd: string): void {
    void this.deps.graphify?.ensureInitialized(cwd).catch(() => {});
  }

  private async isPausedByCancellation(taskId: string, phase: Phase): Promise<boolean> {
    if (phase !== "brainstorm" && phase !== "plan") return false;
    return this.deps.runs.isPhasePausedByCancellation(taskId, phase);
  }

  private async isAwaitingGate(task: Task, phase: Phase): Promise<boolean> {
    if (!task.worktreePath) return false;
    if (phase === "brainstorm") {
      return (await deriveBrainstormGate(task.worktreePath, task.id, this.deps.artifacts)) === "awaiting_user";
    }
    if (phase === "plan") {
      return (await derivePlanGate(task.worktreePath, task.id, this.deps.artifacts)) === "awaiting_user";
    }
    return false;
  }

  private async isTaskAwaitingUser(task: Task): Promise<boolean> {
    const phase = phaseForTaskStatus(task.status);
    return phase ? this.isAwaitingGate(task, phase) : false;
  }

  private taskWithWorktree(taskId: string): Promise<Task & { readonly worktreePath: string }> {
    return this.deps.runs.getTask(taskId).then((task) => this.requireWorktree(task));
  }

  private async taskInStatusWithWorktree(
    taskId: string,
    status: "brainstorming" | "planning",
  ): Promise<Task & { readonly worktreePath: string }> {
    const task = await this.deps.runs.getTask(taskId);
    if (task.status !== status) {
      const code = status === "brainstorming" ? "not_brainstorming" : "not_planning";
      const phaseLabel = status === "brainstorming" ? "brainstorming" : "planning";
      throw new WorkflowConflictError(
        code,
        `task is in ${task.status}; action only applies during ${phaseLabel}`,
      );
    }
    return this.requireWorktree(task);
  }

  private requireWorktree(task: Task): Task & { readonly worktreePath: string } {
    if (!task.worktreePath) {
      throw new WorkflowConflictError("no_worktree", "task has no worktree yet");
    }
    return { ...task, worktreePath: task.worktreePath };
  }

  private async readBrainstormEvents(
    task: Task & { readonly worktreePath: string },
  ): Promise<BrainstormJsonlEvent[]> {
    return readJsonl<BrainstormJsonlEvent>(
      join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl"),
    );
  }

  private assertMockActionUnlocked(events: readonly BrainstormJsonlEvent[], mockId: string): void {
    const lockReason = mockActionLockReason(events, mockId);
    if (lockReason !== null) {
      throw new WorkflowConflictError(lockReason, `mock ${mockId} is no longer selectable`);
    }
  }

  private async cancelAndDrain(taskId: string): Promise<void> {
    this.deps.cancellation?.abort(taskId);
    if (this.scheduler) await this.scheduler.cancelAndDrain(taskId);
  }

  private enqueue(taskId: string): void {
    if (this.scheduler) {
      this.scheduler.enqueue(taskId);
      return;
    }
    this.deps.enqueue?.(taskId);
  }

  private runExclusive<T>(taskId: string, action: () => Promise<T>): Promise<T> {
    return this.deps.mutationLock
      ? this.deps.mutationLock.runExclusive(taskId, action)
      : action();
  }
}

function branchNameFor(taskId: string): string {
  return `pi/${taskId}`;
}

function normalizePhaseModelPatch(
  input: Partial<Record<Phase, PhaseModelPatch>>,
): Partial<Record<Phase, Partial<PhaseModelConfig>>> {
  const normalized: Partial<Record<Phase, Partial<PhaseModelConfig>>> = {};
  for (const [phase, config] of Object.entries(input) as Array<[Phase, PhaseModelPatch | undefined]>) {
    if (config === undefined) continue;
    const patch: Partial<PhaseModelConfig> = {};
    if (config.provider !== undefined) patch.provider = config.provider;
    if (config.model !== undefined) patch.model = config.model;
    if (config.thinkingLevel !== undefined) patch.thinkingLevel = config.thinkingLevel;
    if (config.maxTurns !== undefined) patch.maxTurns = config.maxTurns;
    normalized[phase] = patch;
  }
  return normalized;
}

type MockActionLockReason =
  | "mock_already_selected"
  | "mock_edit_already_submitted"
  | "mock_review_closed";

function mockActionLockReason(
  events: readonly BrainstormJsonlEvent[],
  mockId: string,
): MockActionLockReason | null {
  const latestMockIdx = lastIndexWhere(
    events,
    (event) =>
      (event.kind === "brainstorm_mock_proposed" ||
        event.kind === "brainstorm_mock_revised") &&
      eventMockId(event) === mockId,
  );
  if (latestMockIdx === -1) return null;

  const laterEvents = events.slice(latestMockIdx + 1);
  if (laterEvents.some((event) => event.kind === "brainstorm_mock_selected")) {
    return "mock_already_selected";
  }
  if (
    laterEvents.some(
      (event) =>
        event.kind === "brainstorm_mock_edit_requested" &&
        stringField(event, "mockId") === mockId,
    )
  ) {
    return "mock_edit_already_submitted";
  }
  if (laterEvents.some((event) => event.kind === "brainstorm_revision_requested")) {
    return "mock_review_closed";
  }
  return null;
}

function eventMockId(event: BrainstormJsonlEvent): string | null {
  const mock = event["mock"];
  if (typeof mock !== "object" || mock === null || !("mockId" in mock)) return null;
  const mockId = mock.mockId;
  return typeof mockId === "string" ? mockId : null;
}

function stringField(event: BrainstormJsonlEvent, key: string): string | null {
  const value = event[key];
  return typeof value === "string" ? value : null;
}

function lastIndexWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}
