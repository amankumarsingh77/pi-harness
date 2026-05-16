import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { RunStore } from "../../adapters/run-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
import type { EventStore } from "../../adapters/event-store.js";
import { JsonlWriter, readJsonl } from "../../adapters/jsonl-writer.js";
import { BrainstormEventBus } from "../../agents/brainstorm-event-bus.js";
import { join } from "node:path";
import { ValidationError } from "../../domain/errors.js";
import { deriveBrainstormGate } from "../../agents/brainstorm-gate.js";
import { scaffoldBrainstorm } from "../../runner/scaffold-brainstorm.js";

type BrainstormJsonlEvent = Record<string, unknown> & { kind?: string };

const AnswerEntrySchema = z
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

const SubmitAnswersSchema = z.object({
  // The dashboard always submits the entire question batch at once. Allow up
  // to 20 answers in a single request — well above the realistic batch size
  // (3–5) but bounded so a malformed client can't flood the JSONL.
  answers: z.array(AnswerEntrySchema).min(1).max(20),
});

function mockActionLockReason(
  events: ReadonlyArray<BrainstormJsonlEvent>,
  mockId: string,
): string | null {
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

function lastIndexWhere<T>(items: ReadonlyArray<T>, predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i]!)) return i;
  }
  return -1;
}

// GET /api/tasks/:id/brainstorm
//
// Returns the brainstorm bundle (design + spec artifacts plus the JSONL
// chat log) the dashboard renders. Reads directly from the task's worktree;
// the run-loop is the only writer.
//
// Shape:
//   {
//     gate: "running" | "awaiting_user",
//     status: TaskStatus,
//     design: Artifact | null,
//     spec:   Artifact | null,
//     events: object[],   // parsed lines of brainstorm.jsonl, may be []
//   }
//
// `gate` is derived per request from artifact frontmatter + the JSONL log
// (see deriveBrainstormGate). Always consistent with what the run-loop uses
// to decide whether to dispatch the next tick.
export function registerBrainstormRoutes(
  app: FastifyInstance,
  deps: {
    runs: RunStore;
    artifacts: ArtifactsStore;
    events?: EventStore;
    scheduler?: TaskScheduler;
    cancellation?: CancellationRegistry;
  },
): void {
  app.get<{ Params: { id: string } }>("/api/tasks/:id/brainstorm", async (req, reply) => {
    const task = await deps.runs.getTask(req.params.id);
    const cwd = task.worktreePath;
    if (!cwd) {
      return {
        gate: "running" as const,
        status: task.status,
        design: null,
        spec: null,
        events: [],
      };
    }

    const [design, spec, events, gate] = await Promise.all([
      deps.artifacts.readArtifact(cwd, task.id, "design"),
      deps.artifacts.readArtifact(cwd, task.id, "spec"),
      readJsonl(join(cwd, ".harness", task.id, "brainstorm.jsonl")),
      deriveBrainstormGate(cwd, task.id, deps.artifacts),
    ]);

    void reply; // satisfy typecheck if unused
    return {
      gate,
      status: task.status,
      design,
      spec,
      events,
    };
  });

  // POST /api/tasks/:id/brainstorm/answers
  // Append a batch of brainstorm_answer events to the task's
  // brainstorm.jsonl in a single write, then wake the scheduler exactly
  // once. The dashboard always submits the full question batch at once;
  // partial submission is rejected client-side. Atomic batching here
  // closes the race where the scheduler could fire mid-batch and the agent
  // would see only some of the answers.
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/brainstorm/answers",
    async (req, reply) => {
      let parsed;
      try {
        parsed = SubmitAnswersSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("invalid answers body", { issues: e.issues });
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
      const now = new Date().toISOString();
      for (const a of parsed.answers) {
        await w.append({
          ts: now,
          kind: "brainstorm_answer",
          questionId: a.questionId,
          ...(a.optionId !== undefined ? { optionId: a.optionId } : {}),
          ...(a.optionIds !== undefined ? { optionIds: a.optionIds } : {}),
          ...(a.freeText !== undefined ? { freeText: a.freeText } : {}),
        });
      }
      // One enqueue per batch — the agent's decide() already collects all
      // new answers since the last agent activity, so a single tick covers
      // every entry in this request.
      deps.scheduler?.enqueue(task.id);
      return { ok: true, count: parsed.answers.length };
    },
  );

  // POST /api/tasks/:id/brainstorm/nudge
  // Inject a free-form user message mid-brainstorm. The next agent tick reads
  // this from JSONL via decide() and folds the comment into a "Recent user
  // input" prompt addendum, then republishes the same nudgeId with
  // consumed:true so re-reads of the JSONL don't double-fold it.
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/brainstorm/nudge",
    async (req, reply) => {
      let parsed;
      try {
        parsed = SubmitNudgeSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("invalid nudge body", { issues: e.issues });
        }
        throw e;
      }
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }
      // Refuse nudges once the artifacts are ready and the gate has flipped
      // to awaiting_user — the user should request changes via the revision
      // path instead. Without this, a stray nudge sits unconsumed because
      // runBrainstorm short-circuits on the ready event before reading
      // pending nudges.
      const gate = await deriveBrainstormGate(task.worktreePath, task.id, deps.artifacts);
      if (gate === "awaiting_user") {
        reply.code(409);
        return {
          error: "gate_closed",
          message:
            "brainstorm artifacts are ready and awaiting your approval — request changes instead of nudging",
        };
      }
      const path = join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl");
      const w = new JsonlWriter(path);
      const nudgeId = `n_${randomUUID()}`;
      await w.append({
        ts: new Date().toISOString(),
        kind: "brainstorm_user_nudge",
        nudgeId,
        comment: parsed.comment,
        consumed: false,
      });
      // Wake the agent so it picks up the nudge on the next tick.
      deps.scheduler?.enqueue(task.id);
      return { ok: true, nudgeId };
    },
  );

  // GET /api/tasks/:id/brainstorm/diff?kind=design|spec
  // Returns the artifact body at the baseline commit + the current body.
  // Baseline anchors to the latest revision_requested ts (or the pre-ready
  // commit when no revisions exist). The dashboard computes a line-level
  // diff client-side via jsdiff so the wire shape stays simple.
  app.get<{
    Params: { id: string };
    Querystring: { kind?: string };
  }>("/api/tasks/:id/brainstorm/diff", async (req, reply) => {
    const kind = req.query.kind;
    if (kind !== "design" && kind !== "spec") {
      reply.code(400);
      return { error: "invalid_kind", message: "kind must be 'design' or 'spec'" };
    }
    const task = await deps.runs.getTask(req.params.id);
    const cwd = task.worktreePath;
    if (!cwd) {
      reply.code(409);
      return { error: "no_worktree", message: "task has no worktree yet" };
    }

    // Read JSONL to find the latest revision timestamp (if any).
    const events = await readJsonl(
      join(cwd, ".harness", task.id, "brainstorm.jsonl"),
    );
    let revisionTs: string | null = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i] as { kind?: string; ts?: string };
      if (e.kind === "brainstorm_revision_requested" && typeof e.ts === "string") {
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

  // POST /api/tasks/:id/brainstorm/artifact
  // Replace an artifact's body with a user-authored version. Frontmatter is
  // preserved; status flips to `human_edited` and last_updated_by becomes
  // "human". Commits on the worktree branch and emits a
  // brainstorm_artifact_edited event so the transcript shows the edit.
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/brainstorm/artifact",
    async (req, reply) => {
      let parsed: z.infer<typeof EditArtifactSchema>;
      try {
        parsed = EditArtifactSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("invalid artifact edit body", { issues: e.issues });
        }
        throw e;
      }
      const task = await deps.runs.getTask(req.params.id);
      if (task.status !== "brainstorming") {
        reply.code(409);
        return {
          error: "not_brainstorming",
          message: `task is in ${task.status}; edits only apply during brainstorming`,
        };
      }
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }

      const prior = await deps.artifacts.readArtifact(
        task.worktreePath,
        task.id,
        parsed.kind,
      );
      const sizeDelta = parsed.body.length - (prior?.body.length ?? 0);

      const { commitSha } = await deps.artifacts.applyHumanEdit(
        task.worktreePath,
        task.id,
        parsed.kind,
        parsed.body,
      );

      // Append the edit event to JSONL + (when an active run + EventStore is
      // wired) broadcast through the bus so SSE subscribers see it. Falling
      // back to JSONL-only is fine — the brainstorm bundle GET still surfaces
      // the event on the next page revalidate.
      const activeRun = deps.events
        ? await deps.runs.findActiveRun(task.id, "brainstorm")
        : null;
      if (activeRun && deps.events) {
        const jsonl = new JsonlWriter(
          join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl"),
        );
        const bus = new BrainstormEventBus({
          eventStore: deps.events,
          jsonl,
          runId: activeRun.id,
          taskId: task.id,
        });
        await bus.publish({
          kind: "brainstorm_artifact_edited",
          artifact: parsed.kind,
          commitSha,
          sizeDelta,
        });
      } else {
        const jsonl = new JsonlWriter(
          join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl"),
        );
        await jsonl.append({
          ts: new Date().toISOString(),
          kind: "brainstorm_artifact_edited",
          artifact: parsed.kind,
          commitSha,
          sizeDelta,
        });
      }

      // Wake the agent so it can re-evaluate against the human edit.
      deps.scheduler?.enqueue(task.id);
      return { ok: true, commitSha };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/tasks/:id/brainstorm/mocks",
    async (req, reply) => {
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }
      return deps.artifacts.readBrainstormMockManifest(task.worktreePath, task.id);
    },
  );

  app.get<{ Params: { id: string; mockId: string; pageId: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/pages/:pageId/html",
    async (req, reply) => {
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }
      const manifest = await deps.artifacts.readBrainstormMockManifest(task.worktreePath, task.id);
      const mock = manifest.mocks.find((entry) => entry.mockId === req.params.mockId);
      if (!mock) {
        reply.code(404);
        return { error: "mock_not_found", message: `mock ${req.params.mockId} not found` };
      }
      if (!mock.pages.some((page) => page.pageId === req.params.pageId)) {
        reply.code(404);
        return {
          error: "mock_page_not_found",
          message: `mock page ${req.params.pageId} not found`,
        };
      }
      const html = await deps.artifacts.readBrainstormMockHtml(
        task.worktreePath,
        task.id,
        req.params.mockId,
        req.params.pageId,
      );
      if (html === null) {
        reply.code(404);
        return {
          error: "mock_page_not_found",
          message: `mock page ${req.params.pageId} not found`,
        };
      }
      reply.type("text/html; charset=utf-8");
      return html;
    },
  );

  app.post<{ Params: { id: string; mockId: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/edit",
    async (req, reply) => {
      let parsed: z.infer<typeof EditMockRequestSchema>;
      try {
        parsed = EditMockRequestSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("invalid mock edit body", { issues: e.issues });
        }
        throw e;
      }
      const task = await deps.runs.getTask(req.params.id);
      if (task.status !== "brainstorming") {
        reply.code(409);
        return {
          error: "not_brainstorming",
          message: `task is in ${task.status}; mock edits only apply during brainstorming`,
        };
      }
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }
      const [manifest, events] = await Promise.all([
        deps.artifacts.readBrainstormMockManifest(task.worktreePath, task.id),
        readJsonl<BrainstormJsonlEvent>(
          join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl"),
        ),
      ]);
      if (!manifest.mocks.some((mock) => mock.mockId === req.params.mockId)) {
        reply.code(404);
        return { error: "mock_not_found", message: `mock ${req.params.mockId} not found` };
      }
      const lockReason = mockActionLockReason(events, req.params.mockId);
      if (lockReason !== null) {
        reply.code(409);
        return {
          error: lockReason,
          message: `mock ${req.params.mockId} is no longer editable`,
        };
      }
      const requestId = `mer_${randomUUID()}`;
      await publishBrainstormRouteEvent({
        runs: deps.runs,
        worktreePath: task.worktreePath,
        taskId: task.id,
        ...(deps.events ? { events: deps.events } : {}),
        input: {
          kind: "brainstorm_mock_edit_requested",
          requestId,
          mockId: req.params.mockId,
          comment: parsed.comment,
        },
      });
      deps.scheduler?.enqueue(task.id);
      return { ok: true, requestId };
    },
  );

  app.post<{ Params: { id: string; mockId: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/select",
    async (req, reply) => {
      const task = await deps.runs.getTask(req.params.id);
      if (task.status !== "brainstorming") {
        reply.code(409);
        return {
          error: "not_brainstorming",
          message: `task is in ${task.status}; mock selection only applies during brainstorming`,
        };
      }
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }
      const events = await readJsonl<BrainstormJsonlEvent>(
        join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl"),
      );
      const lockReason = mockActionLockReason(events, req.params.mockId);
      if (lockReason !== null) {
        reply.code(lockReason === "mock_not_found" ? 404 : 409);
        return {
          error: lockReason,
          message: `mock ${req.params.mockId} is no longer selectable`,
        };
      }
      try {
        await deps.artifacts.selectBrainstormMock(
          task.worktreePath,
          task.id,
          req.params.mockId,
        );
      } catch {
        reply.code(404);
        return { error: "mock_not_found", message: `mock ${req.params.mockId} not found` };
      }
      await publishBrainstormRouteEvent({
        runs: deps.runs,
        worktreePath: task.worktreePath,
        taskId: task.id,
        ...(deps.events ? { events: deps.events } : {}),
        input: {
          kind: "brainstorm_mock_selected",
          mockId: req.params.mockId,
        },
      });
      deps.scheduler?.enqueue(task.id);
      return { ok: true, mockId: req.params.mockId };
    },
  );

  // POST /api/tasks/:id/brainstorm/restart
  // Discard the current brainstorm run and dispatch a fresh one. Old per-run
  // files (design.md, spec.md, brainstorm.jsonl, pi-session.jsonl) are
  // moved into runs/<oldRunId>/ on the same task branch — recoverable via
  // git history. The new run starts with empty artifacts. An optional `note`
  // is seeded as the first brainstorm_user_nudge so the new run picks up
  // the user's "what to do differently" guidance on tick 1.
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/brainstorm/restart",
    async (req, reply) => {
      let parsed: z.infer<typeof RestartSchema>;
      try {
        parsed = RestartSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("invalid restart body", { issues: e.issues });
        }
        throw e;
      }
      const task = await deps.runs.getTask(req.params.id);
      if (task.status !== "brainstorming") {
        reply.code(409);
        return {
          error: "not_brainstorming",
          message: `task is in ${task.status}; restart only applies during brainstorming`,
        };
      }
      if (!task.worktreePath) {
        reply.code(409);
        return { error: "no_worktree", message: "task has no worktree yet" };
      }

      // Stop any in-flight tick before touching the JSONL / artifacts.
      // cancelAndDrain calls cancellation.abort + waits; abort alone is a
      // belt-and-suspenders if the route is wired without a scheduler (tests).
      deps.cancellation?.abort(task.id);
      if (deps.scheduler) {
        await deps.scheduler.cancelAndDrain(task.id);
      }

      // Settle the active run so findActiveRun() returns null on the next
      // dispatch. The dashboard's SSE subscription on the old run drops with
      // the cancelled status; the page revalidates and picks up the new run.
      const restartRun =
        (await deps.runs.findActiveRun(task.id, "brainstorm")) ??
        (await deps.runs.findLatestRun(task.id, "brainstorm", "cancelled"));
      if (!restartRun) {
        reply.code(409);
        return {
          error: "no_active_run",
          message: "no active or cancelled brainstorm run to restart",
        };
      }
      if (restartRun.status !== "cancelled") {
        await deps.runs.updateRun(restartRun.id, {
          status: "cancelled",
          endedAt: new Date(),
        });
      }

      // Move old files into runs/<archivedRunId>/.
      await deps.artifacts.archiveCurrentRun(task.worktreePath, task.id, restartRun.id);

      // Re-scaffold draft design.md / spec.md so the next tick has the files
      // it expects to read + write.
      const branch = task.branchName ?? `pi/${task.id}`;
      await scaffoldBrainstorm({
        cwd: task.worktreePath,
        taskId: task.id,
        branch,
      });

      // Write the boundary marker + (optional) seed nudge to the new
      // (now empty) JSONL. Order: nudge first so it shows up at the top of
      // the transcript, then the system event (the dashboard renders it as a
      // "session_reset" SystemLine).
      const newJsonlPath = join(task.worktreePath, ".harness", task.id, "brainstorm.jsonl");
      const w = new JsonlWriter(newJsonlPath);
      const note = parsed.note?.trim();
      if (note && note.length > 0) {
        await w.append({
          ts: new Date().toISOString(),
          kind: "brainstorm_user_nudge",
          nudgeId: `n_${randomUUID()}`,
          comment: note,
          consumed: false,
        });
      }
      await w.append({
        ts: new Date().toISOString(),
          kind: "brainstorm_system",
          systemKind: "session_reset",
          data: {
            archivedRunId: restartRun.id,
            ...(note ? { note } : {}),
          },
        });

      // Create the new Run row + wake the scheduler. dispatchBrainstorm in
      // the run-loop also creates one if findActiveRun is null, but pre-
      // creating it here means the response can return the newRunId for the
      // dashboard to resubscribe immediately.
      const newRun = await deps.runs.createRun({ taskId: task.id, phase: "brainstorm" });
      deps.scheduler?.enqueue(task.id);

      return {
        ok: true,
        archivedRunId: restartRun.id,
        newRunId: newRun.id,
      };
    },
  );
}

const RestartSchema = z.object({
  note: z.string().max(4000).optional(),
});

const EditArtifactSchema = z.object({
  kind: z.enum(["design", "spec"]),
  // Generous upper bound: design+spec are short markdown documents but a
  // user pasting a long replacement should not get rejected. The orchestrator
  // doesn't store these in the DB — they live on the worktree as files.
  body: z.string().min(1).max(64_000),
});

const SubmitNudgeSchema = z.object({
  // Trim then enforce 1..4000 — same range the dashboard textarea allows.
  comment: z
    .string()
    .min(1)
    .max(4000)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "comment must not be blank" }),
});

const EditMockRequestSchema = z.object({
  comment: z
    .string()
    .min(1)
    .max(4000)
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "comment must not be blank" }),
});

async function publishBrainstormRouteEvent(opts: {
  runs: RunStore;
  events?: EventStore;
  worktreePath: string;
  taskId: string;
  input: Parameters<BrainstormEventBus["publish"]>[0];
}): Promise<void> {
  const jsonl = new JsonlWriter(
    join(opts.worktreePath, ".harness", opts.taskId, "brainstorm.jsonl"),
  );
  const activeRun = opts.events
    ? await opts.runs.findActiveRun(opts.taskId, "brainstorm")
    : null;
  if (activeRun && opts.events) {
    const bus = new BrainstormEventBus({
      eventStore: opts.events,
      jsonl,
      runId: activeRun.id,
      taskId: opts.taskId,
    });
    await bus.publish(opts.input);
    return;
  }
  await jsonl.append({
    ts: new Date().toISOString(),
    ...opts.input,
  });
}
