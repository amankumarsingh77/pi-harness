import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { RunStore } from "../../adapters/run-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import { transition } from "../../domain/state-machine.js";
import { CreateTaskSchema, TransitionSchema } from "../schemas.js";
import { isHarnessError, ValidationError } from "../../domain/errors.js";

export function registerTaskRoutes(
  app: FastifyInstance,
  deps: { runs: RunStore; scheduler?: TaskScheduler },
): void {
  const { runs, scheduler } = deps;

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
    const t = await runs.createTask({
      title: parsed.title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    });
    reply.code(201);
    return t;
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
      const result = transition(task, action);
      if (!result.ok) {
        reply.code(result.error.status);
        return {
          error: result.error.code,
          message: result.error.message,
          details: result.error.details,
        };
      }
      const updated = await runs.updateTask(task.id, {
        status: result.task.status,
        workflow: result.task.workflow,
        retryCount: result.task.retryCount,
        awaitingApproval: result.task.awaitingApproval,
      });
      // Tell the scheduler to look. enqueue is fire-and-forget and idempotent
      // — if there's already a tick in flight, this just sets the queued flag.
      // Tests that build the server without a scheduler skip this.
      scheduler?.enqueue(task.id);
      return { task: updated };
    },
  );

  // Centralized error handling — turns HarnessError into the right status.
  app.setErrorHandler((err, _req, reply) => {
    if (isHarnessError(err)) {
      reply.code(err.status);
      return reply.send({ error: err.code, message: err.message, details: err.details });
    }
    reply.code(500);
    const message = err instanceof Error ? err.message : String(err);
    return reply.send({ error: "internal", message });
  });
}
