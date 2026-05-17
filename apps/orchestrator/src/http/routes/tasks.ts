import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { ZodError } from "zod";
import type { AgentEvent, DashboardSummary, Phase, PhaseModelConfig, Task, TaskStatus } from "@pi-harness/shared";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
import type { TaskMutationLock } from "../../runner/task-mutation-lock.js";
import { transition } from "../../domain/state-machine.js";
import { CreateTaskSchema, TransitionSchema, UpdateTaskSchema } from "../schemas.js";
import { ValidationError } from "../../domain/errors.js";
import { JsonlWriter } from "../../adapters/jsonl-writer.js";
import { deriveBrainstormGate } from "../../agents/brainstorm-gate.js";
import { derivePlanGate } from "../../agents/plan-gate.js";

export function registerTaskRoutes(
  app: FastifyInstance,
  deps: {
    runs: RunStore;
    events: EventStore;
    artifacts: ArtifactsStore;
    scheduler?: TaskScheduler;
    cancellation?: CancellationRegistry;
    mutationLock: TaskMutationLock;
  },
): void {
  const { runs, events: eventStore, artifacts, scheduler, cancellation, mutationLock } = deps;

  app.get("/api/tasks", async () => {
    const [tasks, counts, activeRunIds, costUsd, lastEventAt] = await Promise.all([
      runs.listTasks(),
      runs.countByStatus(),
      runs.listActiveRunIds(),
      runs.totalCostUsd(),
      eventStore.latestEventAt(),
    ]);
    const [reviewCount, humanInterventionTaskIds] = await Promise.all([
      deriveReviewCount(tasks, artifacts),
      deriveHumanInterventionTaskIds(tasks, artifacts, eventStore, runs),
    ]);
    return {
      tasks,
      counts,
      humanInterventionTaskIds,
      summary: {
        runningCount: runningCount(counts),
        reviewCount,
        blockedCount: blockedCount(counts),
        costUsd,
        costCapUsd: costCapUsd(process.env.HARNESS_COST_CAP_USD),
        lastEventAt,
        activeRunIds,
      } satisfies DashboardSummary,
    };
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
    const task = await runs.getTask(req.params.id);
    const taskRuns = await runs.listRuns(task.id);
    return { task, runs: taskRuns };
  });

  app.post("/api/tasks", async (req, reply) => {
    let parsed;
    try {
      parsed = CreateTaskSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new ValidationError("invalid task body", { issues: e.issues });
      throw e;
    }
    const t = await runs.createTask({
      title: parsed.title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      priority: parsed.priority,
      tags: parsed.tags,
    });
    reply.code(201);
    return t;
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    let patch;
    try {
      patch = UpdateTaskSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new ValidationError("invalid task patch", { issues: e.issues });
      throw e;
    }

    // Existence check up front so a 404 path doesn't depend on which fields
    // were patched.
    const task = await runs.getTask(req.params.id);

    // phaseModels is frozen once the first run is dispatched. Other fields
    // (title, description) remain editable.
    if (patch.phaseModels !== undefined && (await runs.hasAnyRun(task.id))) {
      reply.code(409);
      return {
        error: "phase_models_frozen",
        message: "Cannot modify phaseModels after the task has started its first run.",
      };
    }

    const updated = await runs.updateTask(task.id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      // Zod's .partial().strict() infers each field as `T | undefined`, but
      // Task.phaseModels' Partial<PhaseModelConfig> shape (under exactOptionalPropertyTypes)
      // wants `T` only. The values are structurally identical at runtime.
      ...(patch.phaseModels !== undefined
        ? {
            phaseModels: patch.phaseModels as Partial<Record<Phase, Partial<PhaseModelConfig>>>,
          }
        : {}),
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/transitions",
    async (req, reply) => {
      let action;
      try {
        action = TransitionSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new ValidationError("invalid action", { issues: e.issues });
        throw e;
      }

      return mutationLock.runExclusive(req.params.id, async () => {
      const task = await runs.getTask(req.params.id);

      // Brainstorm gate enforcement: approve / request-changes are only
      // valid when the derived gate is "awaiting_user". The state machine
      // no longer stores a flag, so the route is the gate's enforcement
      // point. We check before transition() so a stale dashboard click
      // (gate already closed by a concurrent revision) gets a clean 409.
      if (
        action.type === "user_approve_brainstorm" ||
        action.type === "user_request_brainstorm_changes"
      ) {
        if (!task.worktreePath) {
          reply.code(409);
          return { error: "no_worktree", message: "task has no worktree yet" };
        }
        const gate = await deriveBrainstormGate(task.worktreePath, task.id, artifacts);
        if (gate !== "awaiting_user") {
          reply.code(409);
          return {
            error: "gate_closed",
            message: "brainstorm is not awaiting approval",
          };
        }
      }

      if (
        action.type === "user_approve_plan" ||
        action.type === "user_request_plan_changes"
      ) {
        if (!task.worktreePath) {
          reply.code(409);
          return { error: "no_worktree", message: "task has no worktree yet" };
        }
        const gate = await derivePlanGate(task.worktreePath, task.id, artifacts);
        if (gate !== "awaiting_user") {
          reply.code(409);
          return {
            error: "gate_closed",
            message: "plan is not awaiting approval",
          };
        }
      }

      const result = transition(task, action);
      if (!result.ok) {
        reply.code(result.error.status);
        return {
          error: result.error.code,
          message: result.error.message,
          details: result.error.details,
        };
      }
      let shouldEnqueue = true;

      // Revision requests do three things, in this order:
      //   1) Append brainstorm_revision_requested to brainstorm.jsonl so the
      //      next agent tick sees the comment.
      //   2) Reset both artifacts' frontmatter to status: draft. Without
      //      this, a no-op tick would re-derive the gate as awaiting_user
      //      (artifacts still ready on disk + revision event with timestamp
      //      ≤ ready timestamp from the same second); resetting forces the
      //      agent to call mark_ready again before the gate can reopen.
      //   3) Publish brainstorm_revision_requested onto EventStore so the
      //      live SSE stream surfaces the event without a manual refetch.
      if (action.type === "user_request_brainstorm_changes") {
        const cwd = task.worktreePath!; // gate-check above guarantees this
        const ts = new Date();
        const path = join(cwd, ".harness", task.id, "brainstorm.jsonl");
        await new JsonlWriter(path).append({
          ts: ts.toISOString(),
          kind: "brainstorm_revision_requested",
          comment: action.comment,
        });
        // Serialize: setArtifactStatus commits via simple-git, and the
        // git index lock is per-worktree — running both in parallel races.
        await artifacts.setArtifactStatus(cwd, task.id, "design", "draft", "user-revision");
        await artifacts.setArtifactStatus(cwd, task.id, "spec", "draft", "user-revision");
        const activeRun = await runs.findActiveRun(task.id, "brainstorm");
        if (activeRun) {
          await eventStore.append({
            id: crypto.randomUUID(),
            runId: activeRun.id,
            taskId: task.id,
            ts,
            kind: "brainstorm_revision_requested",
            comment: action.comment,
          });
        }
      }

      // Plan-side mirror of brainstorm's revision flow: append the revision
      // event to plan.jsonl, reset both artifacts to draft so the next tick
      // sees the gate as `running`, and broadcast on EventStore so live SSE
      // surfaces the comment without a refetch. Research findings stay
      // intact — only the planner re-runs (see runPlan's revision branch).
      if (action.type === "user_request_plan_changes") {
        const cwd = task.worktreePath!;
        const ts = new Date();
        const path = join(cwd, ".harness", task.id, "plan.jsonl");
        await new JsonlWriter(path).append({
          ts: ts.toISOString(),
          kind: "plan_revision_requested",
          comment: action.comment,
        });
        await artifacts.setArtifactStatus(cwd, task.id, "plan", "draft", "user-revision");
        await artifacts.setArtifactStatus(cwd, task.id, "scenarios", "draft", "user-revision");
        await artifacts.setArtifactStatus(cwd, task.id, "execution-dag", "draft", "user-revision");
        const activeRun = await runs.findActiveRun(task.id, "plan");
        if (activeRun) {
          await eventStore.append({
            id: crypto.randomUUID(),
            runId: activeRun.id,
            taskId: task.id,
            ts,
            kind: "plan_revision_requested",
            comment: action.comment,
          });
        }
      }

      // user_cancel: signal any in-flight phase driver to abort (so its pi
      // session tears down rather than running to turn completion), then
      // settle every active run for the task and emit a phase_ended cancelled
      // event per run so the dashboard's live timeline reflects the cancel
      // moment without a refetch.
      if (action.type === "user_cancel") {
        cancellation?.abort(task.id);
        const activeRuns = await runs.findActiveRunsForTask(task.id);
        const ts = new Date();
        for (const run of activeRuns) {
          await runs.updateRun(run.id, { status: "cancelled", endedAt: ts });
          await eventStore.append({
            id: crypto.randomUUID(),
            runId: run.id,
            taskId: task.id,
            ts,
            kind: "phase_ended",
            phase: run.phase,
            status: "cancelled",
          });
        }
      }

      if (action.type === "user_cancel_current_phase") {
        const phase = currentCancelablePhase(task.status);
        if (!phase) {
          reply.code(409);
          return {
            error: "invalid_transition",
            message: "task must be in brainstorming or planning",
          };
        }

        const activeRun = await runs.findActiveRun(task.id, phase);
        if (!activeRun) {
          reply.code(409);
          return {
            error: "no_active_run",
            message: `no active ${phase} run to cancel`,
          };
        }

        if (scheduler) {
          await scheduler.cancelAndDrain(task.id);
        } else {
          cancellation?.abort(task.id);
        }

        const ts = new Date();
        await runs.updateRun(activeRun.id, { status: "cancelled", endedAt: ts });
        await eventStore.append({
          id: crypto.randomUUID(),
          runId: activeRun.id,
          taskId: task.id,
          ts,
          kind: "phase_ended",
          phase,
          status: "cancelled",
        });
        shouldEnqueue = false;
      }

      // Approval ends the brainstorm phase. The run-loop intentionally leaves
      // the brainstorm run in `running` across all ticks so the dashboard's
      // SSE subscription survives a request-changes round-trip; we close it
      // here, where the phase actually ends.
      if (action.type === "user_approve_brainstorm") {
        const activeRun = await runs.findActiveRun(task.id, "brainstorm");
        if (activeRun) {
          const ts = new Date();
          await runs.updateRun(activeRun.id, {
            status: "succeeded",
            endedAt: ts,
          });
          await eventStore.append({
            id: crypto.randomUUID(),
            runId: activeRun.id,
            taskId: task.id,
            ts,
            kind: "phase_ended",
            phase: "brainstorm",
            status: "succeeded",
          });
        }
      }

      // Same as brainstorm-approve but for plan: settle the long-lived plan
      // run that's been alive across all preflight + planner + revision ticks.
      if (action.type === "user_approve_plan") {
        const activeRun = await runs.findActiveRun(task.id, "plan");
        if (activeRun) {
          const ts = new Date();
          await runs.updateRun(activeRun.id, {
            status: "succeeded",
            endedAt: ts,
          });
          await eventStore.append({
            id: crypto.randomUUID(),
            runId: activeRun.id,
            taskId: task.id,
            ts,
            kind: "phase_ended",
            phase: "plan",
            status: "succeeded",
          });
        }
      }

      const updated = await runs.updateTask(task.id, {
        status: result.task.status,
        workflow: result.task.workflow,
        retryCount: result.task.retryCount,
      });
      // Tell the scheduler to look. enqueue is fire-and-forget and idempotent
      // — if there's already a tick in flight, this just sets the queued flag.
      // Tests that build the server without a scheduler skip this.
      if (shouldEnqueue) scheduler?.enqueue(task.id);
      return { task: updated };
      });
    },
  );
}

const RUNNING_STATUSES: readonly TaskStatus[] = [
  "brainstorming",
  "planning",
  "executing",
  "verifying",
];

const BLOCKED_STATUSES: readonly TaskStatus[] = [
  "brainstorm_failed",
  "plan_failed",
  "code_failed",
  "verification_failed",
  "pr_failed",
];

function runningCount(counts: Partial<Record<TaskStatus, number>>): number {
  return sumStatuses(counts, RUNNING_STATUSES);
}

function blockedCount(counts: Partial<Record<TaskStatus, number>>): number {
  return sumStatuses(counts, BLOCKED_STATUSES);
}

function sumStatuses(
  counts: Partial<Record<TaskStatus, number>>,
  statuses: readonly TaskStatus[],
): number {
  return statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
}

function currentCancelablePhase(status: TaskStatus): "brainstorm" | "plan" | null {
  if (status === "brainstorming") return "brainstorm";
  if (status === "planning") return "plan";
  return null;
}

async function deriveReviewCount(
  tasks: readonly Task[],
  artifacts: ArtifactsStore,
): Promise<number> {
  const reviews = await Promise.all(tasks.map((task) => isAwaitingReview(task, artifacts)));
  return reviews.filter(Boolean).length;
}

async function isAwaitingReview(task: Task, artifacts: ArtifactsStore): Promise<boolean> {
  if (task.status === "ready_to_ship") return true;
  if (!task.worktreePath) return false;
  if (task.status === "brainstorming") {
    return (await deriveBrainstormGate(task.worktreePath, task.id, artifacts)) === "awaiting_user";
  }
  if (task.status === "planning") {
    return (await derivePlanGate(task.worktreePath, task.id, artifacts)) === "awaiting_user";
  }
  return false;
}

async function deriveHumanInterventionTaskIds(
  tasks: readonly Task[],
  artifacts: ArtifactsStore,
  eventStore: EventStore,
  runs: RunStore,
): Promise<readonly string[]> {
  const required = await Promise.all(
    tasks.map(async (task) => ({
      taskId: task.id,
      required: await requiresHumanIntervention(task, artifacts, eventStore, runs),
    })),
  );
  return required.filter((item) => item.required).map((item) => item.taskId);
}

async function requiresHumanIntervention(
  task: Task,
  artifacts: ArtifactsStore,
  eventStore: EventStore,
  runs: RunStore,
): Promise<boolean> {
  if (task.status === "planning") return isPlanningAwaitingUser(task, artifacts);
  if (task.status === "brainstorming") {
    return isBrainstormAwaitingUser(task, artifacts, eventStore, runs);
  }
  return false;
}

async function isPlanningAwaitingUser(
  task: Task,
  artifacts: ArtifactsStore,
): Promise<boolean> {
  if (!task.worktreePath) return false;
  return (await derivePlanGate(task.worktreePath, task.id, artifacts)) === "awaiting_user";
}

async function isBrainstormAwaitingUser(
  task: Task,
  artifacts: ArtifactsStore,
  eventStore: EventStore,
  runs: RunStore,
): Promise<boolean> {
  if (!task.worktreePath) return false;
  const gate = await deriveBrainstormGate(task.worktreePath, task.id, artifacts);
  if (gate === "awaiting_user") return true;

  const activeRun = await runs.findActiveRun(task.id, "brainstorm");
  if (!activeRun) return false;

  const events = await eventStore.listForRun(activeRun.id);
  return hasUnansweredBrainstormQuestion(events) || needsBrainstormMockSelection(events);
}

function hasUnansweredBrainstormQuestion(events: readonly AgentEvent[]): boolean {
  const answeredQuestionIds = new Set(
    events
      .filter((event) => event.kind === "brainstorm_answer")
      .map((event) => event.questionId),
  );

  return events.some(
    (event) =>
      event.kind === "brainstorm_question" && !answeredQuestionIds.has(event.questionId),
  );
}

function needsBrainstormMockSelection(events: readonly AgentEvent[]): boolean {
  const selectedMock = events.some((event) => event.kind === "brainstorm_mock_selected");
  if (selectedMock) return false;

  return events.some(
    (event) =>
      event.kind === "brainstorm_mock_proposed" ||
      event.kind === "brainstorm_mock_revised",
  );
}

function costCapUsd(raw: string | undefined): number {
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}
