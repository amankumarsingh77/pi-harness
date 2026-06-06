import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { join } from "node:path";
import type { RunStore } from "../../adapters/run-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
import type { TaskMutationLock } from "../../runner/task-mutation-lock.js";
import type { EventStore } from "../../adapters/event-store.js";
import type { PreflightStepStore } from "../../adapters/preflight-step-store.js";
import { readJsonl } from "../../adapters/jsonl-writer.js";
import { ValidationError } from "../../domain/errors.js";
import { derivePlanGate } from "../../agents/plan-gate.js";
import { derivePlanAgentGraph } from "../../agents/plan-agent-graph.js";
import { PREFLIGHT_SUBAGENTS } from "../../agents/plan-preflight.js";
import type { TaskWorkflowService } from "../../services/task-workflow-service.js";

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
    preflightSteps?: PreflightStepStore;
    scheduler?: TaskScheduler;
    cancellation?: CancellationRegistry;
    mutationLock: TaskMutationLock;
    workflow: TaskWorkflowService;
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
        phasePlans: [],
        scenarios: null,
        blastRadius: null,
        executionDag: null,
        research: emptyResearch(),
        agentGraph: derivePlanAgentGraph({ events: [], artifactNames: [] }),
        events: [],
        preflightSteps: [],
        preflightBlockedReason: null,
        lastBlocked: null,
      };
    }

    const latestPlanRun = [...(await deps.runs.listRuns(task.id))]
      .reverse()
      .find((run) => run.phase === "plan") ?? null;
    const [plan, phasePlans, scenarios, blastRadius, executionDag, events, gate, research, preflightSteps] = await Promise.all([
      deps.artifacts.readArtifact(cwd, task.id, "plan"),
      deps.artifacts.listPhasePlanArtifacts(cwd, task.id),
      deps.artifacts.readArtifact(cwd, task.id, "scenarios"),
      deps.artifacts.readArtifact(cwd, task.id, "blast-radius"),
      deps.artifacts.readArtifact(cwd, task.id, "execution-dag"),
      readJsonl(join(cwd, ".harness", task.id, "plan.jsonl")),
      derivePlanGate(cwd, task.id, deps.artifacts),
      readResearch(cwd, task.id),
      latestPlanRun && deps.preflightSteps
        ? deps.preflightSteps.latestForRun(latestPlanRun.id)
        : Promise.resolve([]),
    ]);

    const artifactNames = [
      ...(plan ? ["plan.md"] : []),
      ...phasePlans.map((artifact) => `plan-${artifact.fm.phase ?? "?"}.md`),
      ...(scenarios ? ["scenarios.yaml"] : []),
      ...(blastRadius ? ["blast-radius.yaml"] : []),
      ...(executionDag ? ["execution-dag.yaml"] : []),
    ];

    return {
      gate,
      status: task.status,
      plan,
      phasePlans,
      scenarios,
      blastRadius,
      executionDag,
      research,
      agentGraph: derivePlanAgentGraph({ events, artifactNames }),
      events,
      preflightSteps,
      preflightBlockedReason: derivePreflightBlockedReason(preflightSteps),
      lastBlocked: deriveLastBlocked(events),
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
    void reply;
    return deps.workflow.editPlanArtifact({
      taskId: req.params.id,
      kind: parsed.kind,
      body: parsed.body,
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
    void reply;
    return deps.workflow.restartPlan(req.params.id, parsed.note);
  });
}

// Most recent blocked event that isn't superseded by a later status_changed:
// ready. Surfaces a stable, top-level "why the plan stalled" string for the
// dashboard so users don't have to scrub raw event logs to find a timeout
// or claim-verifier failure.
export function deriveLastBlocked(
  events: readonly unknown[],
): { reason: string; ts: string } | null {
  let blocked: { reason: string; ts: string } | null = null;
  for (const raw of events) {
    if (!isRecord(raw)) continue;
    const kind = raw["kind"];
    const ts = typeof raw["ts"] === "string" ? raw["ts"] : null;
    if (!ts) continue;
    if (kind === "plan_system" && raw["systemKind"] === "blocked") {
      const data = raw["data"];
      const reason =
        isRecord(data) && typeof data["reason"] === "string" ? data["reason"] : "";
      blocked = { reason, ts };
    }
    // A later ready or session_reset clears the blocked banner: the plan
    // recovered or the user restarted the phase, so the stale reason is no
    // longer the active failure.
    if (kind === "plan_system" && raw["systemKind"] === "status_changed") {
      const data = raw["data"];
      if (isRecord(data) && data["status"] === "ready") blocked = null;
    }
    if (kind === "plan_system" && raw["systemKind"] === "session_reset") {
      blocked = null;
    }
  }
  return blocked;
}

export function derivePreflightBlockedReason(
  steps: readonly { readonly subagent: string; readonly status: string; readonly required: boolean; readonly error: string | null }[],
): string | null {
  const blocked = steps.filter(
    (step) =>
      step.required &&
      (step.status === "failed" || step.status === "timed_out" || step.status === "cancelled"),
  );
  if (blocked.length === 0) return null;
  return `preflight: hard required findings failed (${blocked.map((step) => step.subagent).join(", ")})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
