import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { join } from "node:path";
import type { RunStore } from "../../adapters/run-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
import type { TaskMutationLock } from "../../runner/task-mutation-lock.js";
import type { EventStore } from "../../adapters/event-store.js";
import { JsonlWriter, readJsonl } from "../../adapters/jsonl-writer.js";
import { PlanEventBus } from "../../agents/plan-event-bus.js";
import { ValidationError } from "../../domain/errors.js";
import { derivePlanGate } from "../../agents/plan-gate.js";
import { scaffoldPlan } from "../../runner/scaffold-plan.js";
import { PREFLIGHT_SUBAGENTS } from "../../agents/plan-preflight.js";

const EditPlanArtifactSchema = z.object({
  // Plan-phase edit-in-place is scoped to plan.md only — scenarios.yaml is
  // structured and the planner authors it. Defer human edits to scenarios
  // until v2.
  kind: z.literal("plan"),
  body: z.string().min(1).max(64_000),
});

const PlanRestartSchema = z.object({
  note: z.string().max(4000).optional(),
});

// GET /api/tasks/:id/plan
//
// Returns the plan-phase bundle the dashboard renders. Mirrors brainstorm's
// shape, with `research` keyed by subagent name surfacing each findings file
// (or null when the subagent hasn't run / failed).
export function registerPlanRoutes(
  app: FastifyInstance,
  deps: {
    runs: RunStore;
    artifacts: ArtifactsStore;
    events?: EventStore;
    scheduler?: TaskScheduler;
    cancellation?: CancellationRegistry;
    mutationLock: TaskMutationLock;
  },
): void {
  app.get<{ Params: { id: string } }>("/api/tasks/:id/plan", async (req) => {
    const task = await deps.runs.getTask(req.params.id);
    const cwd = task.worktreePath;
    if (!cwd) {
      return {
        gate: "running" as const,
        status: task.status,
        plan: null,
        scenarios: null,
        blastRadius: null,
        executionDag: null,
        research: emptyResearch(),
        events: [],
      };
    }

    const [plan, scenarios, blastRadius, executionDag, events, gate, research] = await Promise.all([
      deps.artifacts.readArtifact(cwd, task.id, "plan"),
      deps.artifacts.readArtifact(cwd, task.id, "scenarios"),
      deps.artifacts.readArtifact(cwd, task.id, "blast-radius"),
      deps.artifacts.readArtifact(cwd, task.id, "execution-dag"),
      readJsonl(join(cwd, ".harness", task.id, "plan.jsonl")),
      derivePlanGate(cwd, task.id, deps.artifacts),
      readResearch(cwd, task.id),
    ]);

    return {
      gate,
      status: task.status,
      plan,
      scenarios,
      blastRadius,
      executionDag,
      research,
      events,
    };
  });

  // GET /api/tasks/:id/plan/diff?kind=plan
  //
  // Same baseline-resolution shape as brainstorm's diff. Only `plan` is
  // diffable here — scenarios.yaml is structured and the dashboard renders
  // it through a different control. baseline = artifact at the most recent
  // revision-requested timestamp, falling back to "first commit touching
  // the file" when no revisions have been filed yet.
  app.get<{
    Params: { id: string };
    Querystring: { kind?: string };
  }>("/api/tasks/:id/plan/diff", async (req, reply) => {
    const kind = req.query.kind;
    if (kind !== "plan") {
      reply.code(400);
      return { error: "invalid_kind", message: "kind must be 'plan'" };
    }
    const task = await deps.runs.getTask(req.params.id);
    const cwd = task.worktreePath;
    if (!cwd) {
      reply.code(409);
      return { error: "no_worktree", message: "task has no worktree yet" };
    }

    const events = await readJsonl(join(cwd, ".harness", task.id, "plan.jsonl"));
    let revisionTs: string | null = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i] as { kind?: string; ts?: string };
      if (e.kind === "plan_revision_requested" && typeof e.ts === "string") {
        revisionTs = e.ts;
        break;
      }
    }

    const baselineRef = await deps.artifacts.findDiffBaseline(
      cwd,
      task.id,
      kind,
      revisionTs,
    );
    const [baseline, current] = await Promise.all([
      baselineRef
        ? deps.artifacts.getArtifactAt(cwd, task.id, kind, baselineRef)
        : Promise.resolve(null),
      deps.artifacts.readArtifact(cwd, task.id, kind),
    ]);

    return {
      kind,
      baseline: baseline && baselineRef
        ? { commit: baselineRef, body: baseline.body }
        : null,
      current: current ? { body: current.body } : null,
    };
  });

  // POST /api/tasks/:id/plan/artifact
  //
  // Replace plan.md with a user-authored body. Frontmatter preserved; status
  // flips to `human_edited`; commits on the worktree branch and emits a
  // plan_artifact_edited event.
  app.post<{ Params: { id: string } }>("/api/tasks/:id/plan/artifact", async (req, reply) => {
    let parsed: z.infer<typeof EditPlanArtifactSchema>;
    try {
      parsed = EditPlanArtifactSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("invalid plan artifact edit body", { issues: e.issues });
      }
      throw e;
    }
    return deps.mutationLock.runExclusive(req.params.id, async () => {
      const task = await deps.runs.getTask(req.params.id);
      if (task.status !== "planning") {
        reply.code(409);
        return {
          error: "not_planning",
          message: `task is in ${task.status}; edits only apply during planning`,
        };
      }
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }

      const prior = await deps.artifacts.readArtifact(task.worktreePath, task.id, parsed.kind);
      const sizeDelta = parsed.body.length - (prior?.body.length ?? 0);

      const { commitSha } = await deps.artifacts.applyHumanEdit(
        task.worktreePath,
        task.id,
        parsed.kind,
        parsed.body,
      );

      const activeRun = deps.events
        ? await deps.runs.findActiveRun(task.id, "plan")
        : null;
      if (activeRun && deps.events) {
        const jsonl = new JsonlWriter(
          join(task.worktreePath, ".harness", task.id, "plan.jsonl"),
        );
        const bus = new PlanEventBus({
          eventStore: deps.events,
          jsonl,
          runId: activeRun.id,
          taskId: task.id,
        });
        await bus.publish({
          kind: "plan_artifact_edited",
          artifact: parsed.kind,
          commitSha,
          sizeDelta,
        });
      } else {
        const jsonl = new JsonlWriter(
          join(task.worktreePath, ".harness", task.id, "plan.jsonl"),
        );
        await jsonl.append({
          ts: new Date().toISOString(),
          kind: "plan_artifact_edited",
          artifact: parsed.kind,
          commitSha,
          sizeDelta,
        });
      }

      deps.scheduler?.enqueue(task.id);
      return { ok: true, commitSha };
    });
  });

  // POST /api/tasks/:id/plan/restart
  //
  // Discard the current plan run, archive plan.md / scenarios.yaml /
  // plan.jsonl / pi-session-plan.jsonl + the entire research/ directory into
  // runs/<oldRunId>/, scaffold afresh, and dispatch a new run. The next tick
  // re-runs the full preflight (research files no longer exist) followed by
  // the planner.
  app.post<{ Params: { id: string } }>("/api/tasks/:id/plan/restart", async (req, reply) => {
    let parsed: z.infer<typeof PlanRestartSchema>;
    try {
      parsed = PlanRestartSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new ValidationError("invalid plan restart body", { issues: e.issues });
      }
      throw e;
    }
    return deps.mutationLock.runExclusive(req.params.id, async () => {
      const task = await deps.runs.getTask(req.params.id);
      if (task.status !== "planning") {
        reply.code(409);
        return {
          error: "not_planning",
          message: `task is in ${task.status}; restart only applies during planning`,
        };
      }
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }

      deps.cancellation?.abort(task.id);
      if (deps.scheduler) {
        await deps.scheduler.cancelAndDrain(task.id);
      }

      const restartRun =
        (await deps.runs.findActiveRun(task.id, "plan")) ??
        (await deps.runs.findLatestRun(task.id, "plan", "cancelled"));
      if (!restartRun) {
        reply.code(409);
        return {
          error: "no_active_run",
          message: "no active or cancelled plan run to restart",
        };
      }
      if (restartRun.status !== "cancelled") {
        await deps.runs.updateRun(restartRun.id, {
          status: "cancelled",
          endedAt: new Date(),
        });
      }

      await deps.artifacts.archiveCurrentRun(task.worktreePath, task.id, restartRun.id, "plan");

      const branch = task.branchName ?? `pi/${task.id}`;
      await scaffoldPlan({
        cwd: task.worktreePath,
        taskId: task.id,
        branch,
      });

      const newJsonlPath = join(task.worktreePath, ".harness", task.id, "plan.jsonl");
      const w = new JsonlWriter(newJsonlPath);
      const note = parsed.note?.trim();
      await w.append({
        ts: new Date().toISOString(),
        kind: "plan_system",
        systemKind: "session_reset",
        data: {
          archivedRunId: restartRun.id,
          ...(note ? { note } : {}),
        },
      });

      const newRun = await deps.runs.createRun({ taskId: task.id, phase: "plan" });
      deps.scheduler?.enqueue(task.id);

      return {
        ok: true,
        archivedRunId: restartRun.id,
        newRunId: newRun.id,
      };
    });
  });
}

function emptyResearch(): Record<string, null> {
  const out: Record<string, null> = {};
  for (const sa of PREFLIGHT_SUBAGENTS) out[sa] = null;
  out["claim-verifier"] = null;
  return out;
}

async function readResearch(cwd: string, taskId: string): Promise<Record<string, string | null>> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const dir = join(cwd, ".harness", taskId, "research");
  const out: Record<string, string | null> = {};
  const all = [...PREFLIGHT_SUBAGENTS, "claim-verifier"];
  for (const name of all) {
    const path = join(dir, `${name}.md`);
    if (existsSync(path)) {
      out[name] = await readFile(path, "utf8");
    } else {
      out[name] = null;
    }
  }
  return out;
}
