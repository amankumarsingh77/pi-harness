import { existsSync, readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import type { RunStore } from "../../adapters/run-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import { JsonlWriter } from "../../adapters/jsonl-writer.js";
import { join } from "node:path";
import { ValidationError } from "../../domain/errors.js";

const SubmitAnswerSchema = z
  .object({
    questionId: z.string().min(1).max(120),
    optionId: z.string().min(1).max(120).optional(),
    optionIds: z.array(z.string().min(1).max(120)).min(1).max(20).optional(),
    freeText: z.string().min(1).max(2000).optional(),
  })
  .refine(
    (v) =>
      v.optionId !== undefined ||
      (v.optionIds !== undefined && v.optionIds.length > 0) ||
      v.freeText !== undefined,
    { message: "must provide optionId, optionIds, or freeText" },
  );

// GET /api/tasks/:id/brainstorm
//
// Returns the brainstorm bundle (design + spec artifacts plus the JSONL
// chat log) the dashboard renders. Reads directly from the task's worktree;
// the run-loop is the only writer.
//
// Shape:
//   {
//     awaitingApproval: boolean,
//     status: TaskStatus,
//     design: Artifact | null,
//     spec:   Artifact | null,
//     events: object[],   // parsed lines of brainstorm.jsonl, may be []
//   }
export function registerBrainstormRoutes(
  app: FastifyInstance,
  deps: { runs: RunStore; artifacts: ArtifactsStore; scheduler?: TaskScheduler },
): void {
  app.get<{ Params: { id: string } }>("/api/tasks/:id/brainstorm", async (req, reply) => {
    const task = await deps.runs.getTask(req.params.id);
    const cwd = task.worktreePath;
    if (!cwd) {
      return {
        awaitingApproval: task.awaitingApproval,
        status: task.status,
        design: null,
        spec: null,
        events: [],
      };
    }

    const [design, spec] = await Promise.all([
      deps.artifacts.readArtifact(cwd, task.id, "design"),
      deps.artifacts.readArtifact(cwd, task.id, "spec"),
    ]);

    const jsonlPath = join(cwd, ".harness", task.id, "brainstorm.jsonl");
    let events: unknown[] = [];
    if (existsSync(jsonlPath)) {
      const raw = readFileSync(jsonlPath, "utf8");
      events = raw
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          try {
            return JSON.parse(l) as unknown;
          } catch {
            return null;
          }
        })
        .filter((x) => x !== null);
    }

    void reply; // satisfy typecheck if unused
    return {
      awaitingApproval: task.awaitingApproval,
      status: task.status,
      design,
      spec,
      events,
    };
  });

  // POST /api/tasks/:id/brainstorm/answer
  // Append a brainstorm_answer event to the task's brainstorm.jsonl. The
  // run-loop's next tick advances the script and emits the next question.
  // Note: we write to JSONL only here, not EventStore — the next runBrainstorm
  // tick republishes via the bus if needed.
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/brainstorm/answer",
    async (req, reply) => {
      let parsed;
      try {
        parsed = SubmitAnswerSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("invalid answer body", { issues: e.issues });
        }
        throw e;
      }
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }
      const path = join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl");
      const w = new JsonlWriter(path);
      await w.append({
        ts: new Date().toISOString(),
        kind: "brainstorm_answer",
        questionId: parsed.questionId,
        ...(parsed.optionId !== undefined ? { optionId: parsed.optionId } : {}),
        ...(parsed.optionIds !== undefined ? { optionIds: parsed.optionIds } : {}),
        ...(parsed.freeText !== undefined ? { freeText: parsed.freeText } : {}),
      });
      // Wake the agent: it reads JSONL on entry and walks to the next
      // question (or finalizes). Without this, the answer is durable but
      // invisible to the script.
      deps.scheduler?.enqueue(task.id);
      return { ok: true };
    },
  );
}
