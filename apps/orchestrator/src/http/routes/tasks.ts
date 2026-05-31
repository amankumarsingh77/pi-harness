import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  isBlockedTaskStatus,
  isRunningTaskStatus,
  TASK_STATUSES,
  type AgentEvent,
  type DashboardSummary,
  type Task,
  type TaskStatus,
} from "@pi-harness/shared";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
import type { TaskMutationLock } from "../../runner/task-mutation-lock.js";
import type { MissionStore } from "../../adapters/mission-store.js";
import { CreateTaskSchema, TransitionSchema, UpdateTaskSchema } from "../schemas.js";
import { ValidationError } from "../../domain/errors.js";
import { deriveBrainstormGate } from "../../agents/brainstorm-gate.js";
import { derivePlanGate } from "../../agents/plan-gate.js";
import type { TaskWorkflowService } from "../../services/task-workflow-service.js";

export function registerTaskRoutes(
  app: FastifyInstance,
  deps: {
    runs: RunStore;
    events: EventStore;
    artifacts: ArtifactsStore;
    missionStore?: MissionStore;
    scheduler?: TaskScheduler;
    cancellation?: CancellationRegistry;
    mutationLock: TaskMutationLock;
    workflow: TaskWorkflowService;
  },
): void {
  const { runs, events: eventStore, artifacts, workflow } = deps;

  app.get("/api/tasks", async () => {
    return buildDashboardTaskList({ runs, eventStore, artifacts });
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
    const t = await workflow.createTask({
      title: parsed.title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      priority: parsed.priority,
      tags: parsed.tags,
      ...(parsed.phaseModels !== undefined ? { phaseModels: parsed.phaseModels } : {}),
    });
    reply.code(201);
    return t;
  });

  app.patch<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
    let patch;
    try {
      patch = UpdateTaskSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new ValidationError("invalid task patch", { issues: e.issues });
      throw e;
    }

    const updated = await workflow.updateTaskMetadata(req.params.id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.phaseModels !== undefined ? { phaseModels: patch.phaseModels } : {}),
    });
    return updated;
  });

  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/transitions",
    async (req) => {
      let action;
      try {
        action = TransitionSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new ValidationError("invalid action", { issues: e.issues });
        throw e;
      }

      return workflow.applyUserTransition(req.params.id, action);
    },
  );
}

export async function buildDashboardTaskList(deps: {
  runs: RunStore;
  eventStore: EventStore;
  artifacts: ArtifactsStore;
}): Promise<{
  tasks: Task[];
  counts: Record<TaskStatus, number>;
  humanInterventionTaskIds: readonly string[];
  summary: DashboardSummary;
}> {
  const [tasks, counts, activeRunIds, costUsd, lastEventAt] = await Promise.all([
    deps.runs.listTasks(),
    deps.runs.countByStatus(),
    deps.runs.listActiveRunIds(),
    deps.runs.totalCostUsd(),
    deps.eventStore.latestEventAt(),
  ]);
  const [reviewCount, humanInterventionTaskIds] = await Promise.all([
    deriveReviewCount(tasks, deps.artifacts),
    deriveHumanInterventionTaskIds(tasks, deps.artifacts, deps.eventStore, deps.runs),
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
    },
  };
}

function runningCount(counts: Partial<Record<TaskStatus, number>>): number {
  return sumStatuses(counts, isRunningTaskStatus);
}

function blockedCount(counts: Partial<Record<TaskStatus, number>>): number {
  return sumStatuses(counts, isBlockedTaskStatus);
}

function sumStatuses(
  counts: Partial<Record<TaskStatus, number>>,
  predicate: (status: TaskStatus) => boolean,
): number {
  return TASK_STATUSES.reduce(
    (total, status) => (predicate(status) ? total + (counts[status] ?? 0) : total),
    0,
  );
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
