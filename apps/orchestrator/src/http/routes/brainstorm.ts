import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { readFile } from "node:fs/promises";
import type { RunStore } from "../../adapters/run-store.js";
import type { ArtifactsStore } from "../../agents/artifacts-store.js";
import type { TaskScheduler } from "../../runner/scheduler.js";
import type { CancellationRegistry } from "../../runner/cancellation.js";
import type { TaskMutationLock } from "../../runner/task-mutation-lock.js";
import type { EventStore } from "../../adapters/event-store.js";
import { readJsonl } from "../../adapters/jsonl-writer.js";
import { join } from "node:path";
import { ValidationError } from "../../domain/errors.js";
import { deriveBrainstormGate } from "../../agents/brainstorm-gate.js";
import type { TaskWorkflowService } from "../../services/task-workflow-service.js";
import { distillTokensStub } from "../../agents/promote-distill.js";
import { TokenDiffSchema } from "../../agents/design-system-types.js";
import type { DesignSystemStore } from "../../agents/design-system-store.js";

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
  // to 20 answers in a single request so focused multi-question batches work
  // while a malformed client still cannot flood the JSONL.
  answers: z.array(AnswerEntrySchema).min(1).max(20),
});

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
    mutationLock: TaskMutationLock;
    workflow: TaskWorkflowService;
    designSystem: DesignSystemStore;
    designRootCwd: string;
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
  // brainstorm.jsonl through the centralized phase event log, then wake the scheduler exactly
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
      void reply;
      return deps.workflow.submitBrainstormAnswers(req.params.id, parsed.answers);
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
      void reply;
      return deps.workflow.submitBrainstormNudge(req.params.id, parsed.comment);
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
      void reply;
      return deps.workflow.editBrainstormArtifact({
        taskId: req.params.id,
        kind: parsed.kind,
        body: parsed.body,
      });
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
      const tokensCss = await readMockPreviewTokens({
        designSystem: deps.designSystem,
        cwd: task.worktreePath,
        taskId: task.id,
      });
      reply.type("text/html; charset=utf-8");
      return withMockPreviewCss(html, tokensCss);
    },
  );

  // PNG for a rendered mock page
  app.get<{ Params: { id: string; mockId: string; pageId: string; viewport: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/pages/:pageId/png/:viewport",
    async (req, reply) => {
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) { reply.code(409); return { error: "no_worktree" }; }
      const vp = req.params.viewport === "mobile" ? "mobile" : "desktop";
      const png = await deps.artifacts.readBrainstormMockPng(task.worktreePath, task.id, req.params.mockId, req.params.pageId, vp);
      if (!png) { reply.code(404); return { error: "render_not_found" }; }
      reply.type("image/png");
      return png;
    },
  );

  // Promote: distill only, return diff (no write)
  app.post<{ Params: { id: string; mockId: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/promote",
    async (req, reply) => {
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) { reply.code(409); return { error: "no_worktree" }; }
      const manifest = await deps.artifacts.readBrainstormMockManifest(task.worktreePath, task.id);
      const mock = manifest.mocks.find((m) => m.mockId === req.params.mockId);
      if (!mock) { reply.code(404); return { error: "mock_not_found" }; }
      const firstPage = mock.pages[0];
      if (!firstPage) { reply.code(404); return { error: "mock_page_not_found" }; }
      const ds = await deps.designSystem.read(task.worktreePath);
      const html = (await deps.artifacts.readBrainstormMockHtml(task.worktreePath, task.id, mock.mockId, firstPage.pageId)) ?? "";
      return distillTokensStub({ mockHtml: html, currentTokensCss: ds.tokensCss, fromVersion: ds.manifest.tokenVersion, title: mock.title });
    },
  );

  // Promote confirm: write + commit + publish
  app.post<{ Params: { id: string; mockId: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/promote/confirm",
    async (req, reply) => {
      const task = await deps.runs.getTask(req.params.id);
      if (!task.worktreePath) { reply.code(409); return { error: "no_worktree" }; }
      let diff: import("../../agents/design-system-types.js").TokenDiff;
      try {
        diff = TokenDiffSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) { throw new ValidationError("invalid token diff body", { issues: e.issues }); }
        throw e;
      }
      const manifest = await deps.artifacts.readBrainstormMockManifest(task.worktreePath, task.id);
      const mock = manifest.mocks.find((m) => m.mockId === req.params.mockId);
      if (!mock) { reply.code(404); return { error: "mock_not_found" }; }
      const firstPage = mock.pages[0];
      if (!firstPage) { reply.code(404); return { error: "mock_page_not_found" }; }
      const desktopPng = await deps.artifacts.readBrainstormMockPng(task.worktreePath, task.id, mock.mockId, firstPage.pageId, "desktop");
      const ds = await deps.designSystem.read(task.worktreePath);
      const nextTokensCss = applyTokenDiff(ds.tokensCss, diff);
      const { tokenVersion, exemplarId } = await deps.designSystem.writePromotion(task.worktreePath, {
        tokensCss: nextTokensCss,
        designMdDelta: diff.designMdDelta,
        summary: diff.summary,
        task: task.id,
        exemplar: { title: mock.title, pngBytes: desktopPng ?? Buffer.alloc(0), promotedMockId: mock.mockId },
      });
      await deps.designSystem.commitToMain(task.worktreePath, `design(system): promote ${mock.title} (v${tokenVersion})`);
      return { ok: true, tokenVersion, exemplarId };
    },
  );

  // Design system snapshot (project-level, lives at repo root)
  app.get("/api/design", async () => {
    return deps.designSystem.read(deps.designRootCwd);
  });

  app.get<{ Params: { exemplarId: string } }>(
    "/api/design/gallery/:exemplarId/png",
    async (req, reply) => {
      const buf = await deps.designSystem.readExemplarPng(deps.designRootCwd, req.params.exemplarId);
      if (!buf) { reply.code(404); return { error: "exemplar_not_found" }; }
      reply.type("image/png");
      return buf;
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
      void reply;
      return deps.workflow.requestBrainstormMockEdit({
        taskId: req.params.id,
        mockId: req.params.mockId,
        comment: parsed.comment,
      });
    },
  );

  app.post<{ Params: { id: string; mockId: string } }>(
    "/api/tasks/:id/brainstorm/mocks/:mockId/select",
    async (req, reply) => {
      void reply;
      return deps.workflow.selectBrainstormMock(req.params.id, req.params.mockId);
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
      void reply;
      return deps.workflow.restartBrainstorm(req.params.id, parsed.note);
    },
  );
}

type MockPreviewTokenDeps = {
  readonly designSystem: Pick<DesignSystemStore, "read" | "readDraftTokens">;
  readonly cwd: string;
  readonly taskId: string;
};

async function readMockPreviewTokens({
  designSystem,
  cwd,
  taskId,
}: MockPreviewTokenDeps): Promise<string> {
  const ds = await designSystem.read(cwd);
  if (ds.tokensCss.trim().length > 0) return ds.tokensCss;
  const draftTokens = await designSystem.readDraftTokens(cwd, taskId);
  if (draftTokens.trim().length > 0) return draftTokens;
  return readDashboardThemeTokens(cwd);
}

async function readDashboardThemeTokens(cwd: string): Promise<string> {
  try {
    const globalsCss = await readFile(join(cwd, "apps", "dashboard", "app", "globals.css"), "utf8");
    return dashboardThemeToRootTokens(globalsCss);
  } catch {
    return "";
  }
}

function dashboardThemeToRootTokens(css: string): string {
  const match = /@theme\s*{([\s\S]*?)}/.exec(css);
  const body = match?.[1]?.trim();
  return body === undefined || body.length === 0 ? "" : `:root{${body}\n}`;
}

function mockPreviewStyle(tokensCss: string): string {
  return `<style data-pi-harness-mock-preview>${tokensCss.trim()}
html,body{margin:0;min-width:100%;min-height:100%;background:var(--color-bg,#0d0e10);}
*{animation:none!important;transition:none!important;}</style>`;
}

function withMockPreviewCss(html: string, tokensCss: string): string {
  if (html.includes("data-pi-harness-mock-preview")) return html;
  const style = mockPreviewStyle(tokensCss);
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index === undefined) return `${style}${html}`;
  const insertAt = head.index + head[0].length;
  return `${html.slice(0, insertAt)}${style}${html.slice(insertAt)}`;
}

function applyTokenDiff(currentCss: string, diff: { changes: { name: string; after: string | null }[] }): string {
  let css = currentCss.trim();
  if (!css) css = ":root{}";
  for (const c of diff.changes) {
    if (c.after === null) continue;
    const re = new RegExp(`(${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*)[^;]+;`);
    if (re.test(css)) css = css.replace(re, `$1${c.after};`);
    else css = css.replace(/:root\s*{/, `:root{${c.name}:${c.after};`);
  }
  return css;
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
