import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { ZodError } from "zod";
import { DEFAULT_PHASE_MODELS, PHASES, type Phase, type PhaseModelConfig } from "@pi-harness/shared";
import { getModelCatalog, modelCatalogContains } from "@pi-harness/pi-bridge";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
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
  },
): void {
  const { runs, events: eventStore, artifacts, scheduler, cancellation } = deps;

  app.get("/api/tasks", async () => {
    const [tasks, counts] = await Promise.all([runs.listTasks(), runs.countByStatus()]);
    return { tasks, counts };
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
    validatePhaseModels(parsed.phaseModels ?? {});
    const t = await runs.createTask({
      title: parsed.title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.phaseModels !== undefined ? { phaseModels: parsed.phaseModels } : {}),
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
      scheduler?.enqueue(task.id);
      return { task: updated };
    },
  );
}

type ParsedPhaseModels = Partial<
  Record<
    Phase,
    {
      provider?: string | undefined;
      model?: string | undefined;
      thinkingLevel?: PhaseModelConfig["thinkingLevel"] | undefined;
      maxTurns?: number | undefined;
    }
  >
>;

function validatePhaseModels(phaseModels: ParsedPhaseModels): void {
  const catalog = getModelCatalog();
  const invalid = PHASES
    .map((phase) => {
      const defaults = DEFAULT_PHASE_MODELS[phase];
      const override = phaseModels[phase];
      return {
        phase,
        provider: override?.provider ?? defaults.provider,
        model: override?.model ?? defaults.model,
      };
    })
    .find(({ provider, model }) => !modelCatalogContains(catalog, provider, model));
  if (!invalid) return;
  throw new ValidationError("unknown phase model", {
    phase: invalid.phase,
    provider: invalid.provider,
    model: invalid.model,
  });
}
