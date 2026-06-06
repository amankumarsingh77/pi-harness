import { Type, type Static, type TSchema } from "typebox";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Artifact, BrainstormMock } from "@pi-harness/shared";
import {
  BRAINSTORM_REQUIRED_SECTIONS,
  type BrainstormArtifactKind,
} from "./brainstorm-artifact-contract.js";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { BrainstormEventBus } from "./brainstorm-event-bus.js";
import { findTokenViolations } from "./token-conformance.js";
import type { DesignSystemStore } from "./design-system-store.js";
import type { MockRenderer } from "./mock-renderer.js";

// Mirrors the SDK's AgentToolResult shape without depending on the SDK package
// here — that coupling lives in pi-bridge. ToolDefinition shape is structural;
// matching content/details/terminate is enough for the SDK to consume it.
type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  details: T;
  terminate?: boolean;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

const QuestionOption = Type.Object({
  id: Type.String(),
  label: Type.String(),
  recommended: Type.Boolean(),
  evidence: Type.Array(Type.String()),
});

const Question = Type.Object({
  questionId: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  options: Type.Array(QuestionOption, { minItems: 2 }),
  sectionTarget: Type.Object({
    artifact: Type.Union([Type.Literal("design"), Type.Literal("spec")]),
    section: Type.String(),
  }),
  multiSelect: Type.Optional(Type.Boolean()),
});

const SubmitQuestionsParams = Type.Object({
  questions: Type.Array(Question, { minItems: 1 }),
});

const BrainstormArtifactKindParam = Type.Union([Type.Literal("design"), Type.Literal("spec")]);

const ReadArtifactParams = Type.Object({
  kind: BrainstormArtifactKindParam,
});

const WriteArtifactParams = Type.Object({
  kind: BrainstormArtifactKindParam,
  body: Type.String({ minLength: 1, maxLength: 250_000 }),
});

const MarkReadyParams = Type.Object({});

const ReplyToUserParams = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  inReplyToNudgeId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const SafeSlug = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: "^[a-z0-9][a-z0-9-]*$",
});

const MockPageChoice = Type.Object({
  pageId: SafeSlug,
  title: Type.String({ minLength: 1, maxLength: 120 }),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  html: Type.String({ minLength: 1, maxLength: 250_000 }),
});

const MockMiniature = Type.Union([
  Type.Object({
    kind: Type.Literal("rows"),
    rows: Type.Array(
      Type.Object({
        status: Type.Union([
          Type.Literal("pass"),
          Type.Literal("fail"),
          Type.Literal("muted"),
        ]),
        label: Type.String({ minLength: 1, maxLength: 80 }),
        sub: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        action: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
      }),
      { minItems: 1, maxItems: 8 },
    ),
  }),
  Type.Object({
    kind: Type.Literal("grid+drawer"),
    cells: Type.Array(
      Type.Object({
        status: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
      }),
      { minItems: 1, maxItems: 8 },
    ),
    drawerTitle: Type.String({ minLength: 1, maxLength: 80 }),
    diffLines: Type.Array(
      Type.Object({
        kind: Type.Union([Type.Literal("plus"), Type.Literal("minus")]),
      }),
      { minItems: 1, maxItems: 8 },
    ),
    confirm: Type.String({ minLength: 1, maxLength: 40 }),
  }),
]);

const MockChoice = Type.Object({
  mockId: SafeSlug,
  title: Type.String({ minLength: 1, maxLength: 120 }),
  summary: Type.String({ minLength: 1, maxLength: 500 }),
  recommended: Type.Boolean(),
  evidence: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { minItems: 1, maxItems: 12 }),
  contextSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
  miniature: Type.Optional(MockMiniature),
  pages: Type.Array(MockPageChoice, { minItems: 1, maxItems: 6 }),
});

const SubmitMockChoicesParams = Type.Object({
  mocks: Type.Array(MockChoice, { minItems: 1, maxItems: 6 }),
});

const WriteMockRevisionParams = Type.Object({
  sourceMockId: SafeSlug,
  mockId: SafeSlug,
  editRequestId: Type.String({ minLength: 1, maxLength: 120 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  summary: Type.String({ minLength: 1, maxLength: 500 }),
  evidence: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { minItems: 1, maxItems: 12 }),
  contextSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
  miniature: Type.Optional(MockMiniature),
  pages: Type.Array(MockPageChoice, { minItems: 1, maxItems: 6 }),
});

export type SubmitQuestionsDetails = { awaiting: string[] };
export type ReadArtifactDetails = {
  found: boolean;
  kind: BrainstormArtifactKind;
  path?: string;
  status?: string;
};
export type WriteArtifactDetails = {
  ok: boolean;
  kind: BrainstormArtifactKind;
  path?: string;
  bytes?: number;
  error?: string;
};
export type MarkReadyDetails = {
  ok: boolean;
  missing?: string;
  kind?: BrainstormArtifactKind;
  path?: string;
};
export type ReplyToUserDetails = { replyId: string };

function baseMockId(mockId: string): string {
  return mockId.replace(/-rev\d+$/, "");
}

function nextRevisionMockId(sourceMockId: string, existingMockIds: ReadonlyArray<string>): string {
  const base = baseMockId(sourceMockId);
  const revisionPattern = new RegExp(`^${escapeRegExp(base)}-rev(\\d+)$`);
  const latestRevision = existingMockIds.reduce((latest, mockId) => {
    const match = revisionPattern.exec(mockId);
    if (!match) return latest;
    const revision = Number(match[1]);
    return Number.isInteger(revision) ? Math.max(latest, revision) : latest;
  }, 0);
  return `${base}-rev${latestRevision + 1}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function makeSubmitQuestionsTool(deps: {
  bus: BrainstormEventBus;
}): ToolLike<typeof SubmitQuestionsParams, SubmitQuestionsDetails> {
  return {
    name: "submit_questions",
    label: "Submit questions",
    description:
      "Batch-submit one or more brainstorm questions for the user to answer. After calling this, halt your turn; the harness will resume you with the user's answers.",
    parameters: SubmitQuestionsParams,
    async execute(_id, params) {
      // Every question in one tool call shares a batchId. The dashboard uses
      // this to group the questions into one composite card with a single
      // Submit button so the user can't answer 2/3 and have the agent
      // mark ready off partial input.
      const batchId = `b_${randomUUID()}`;
      for (const q of params.questions) {
        await deps.bus.publish({
          kind: "brainstorm_question",
          questionId: q.questionId,
          prompt: q.prompt,
          options: q.options,
          sectionTarget: q.sectionTarget,
          batchId,
          ...(q.multiSelect ? { multiSelect: true } : {}),
        });
      }
      return {
        content: [{ type: "text", text: "submitted" }],
        details: { awaiting: params.questions.map((q) => q.questionId) },
        terminate: true,
      };
    },
  };
}

function startsWithYamlFrontmatter(body: string): boolean {
  return body.trimStart().startsWith("---\n") || body.trimStart() === "---";
}

export function makeReadArtifactTool(deps: {
  store: ArtifactsStore;
  cwd: string;
  taskId: string;
}): ToolLike<typeof ReadArtifactParams, ReadArtifactDetails> {
  const { store, cwd, taskId } = deps;
  return {
    name: "read_artifact",
    label: "Read brainstorm artifact",
    description:
      "Read the current body of design.md or spec.md from the task artifact store. The path is owned by the harness; pass only kind.",
    parameters: ReadArtifactParams,
    async execute(_id, params) {
      const path = store.artifactPath(cwd, taskId, params.kind);
      const art = await store.readArtifact(cwd, taskId, params.kind);
      if (!art) {
        return {
          content: [{ type: "text", text: `${params.kind}.md not found` }],
          details: { found: false, kind: params.kind, path },
        };
      }
      return {
        content: [{ type: "text", text: art.body }],
        details: { found: true, kind: params.kind, status: art.fm.status },
      };
    },
  };
}

export function makeWriteArtifactTool(deps: {
  store: ArtifactsStore;
  cwd: string;
  taskId: string;
}): ToolLike<typeof WriteArtifactParams, WriteArtifactDetails> {
  const { store, cwd, taskId } = deps;
  return {
    name: "write_artifact",
    label: "Write brainstorm artifact body",
    description:
      "Replace the body of design.md or spec.md while preserving harness-owned frontmatter. Pass only kind and markdown body; do not include YAML frontmatter.",
    parameters: WriteArtifactParams,
    async execute(_id, params) {
      const path = store.artifactPath(cwd, taskId, params.kind);
      if (startsWithYamlFrontmatter(params.body)) {
        const error = "artifact body must not include YAML frontmatter";
        return {
          content: [{ type: "text", text: error }],
          details: { ok: false, kind: params.kind, path, error },
        };
      }

      const current = await store.readArtifact(cwd, taskId, params.kind);
      if (!current) {
        const error = `${params.kind}.md not found`;
        return {
          content: [{ type: "text", text: error }],
          details: { ok: false, kind: params.kind, path, error },
        };
      }

      await store.writeArtifact(cwd, taskId, {
        fm: current.fm,
        body: params.body,
      });
      return {
        content: [{ type: "text", text: `wrote ${params.kind}.md body` }],
        details: { ok: true, kind: params.kind, bytes: params.body.length },
      };
    },
  };
}

// Returns the first missing-section error string, or null if all sections are
// present with non-empty bodies. A section's body runs from immediately after
// the heading line to the next line beginning with "## " (or EOF). "Empty"
// means no non-whitespace character appears in that range.
function findMissingSection(kind: BrainstormArtifactKind, body: string): string | null {
  const lines = body.split("\n");
  for (const heading of BRAINSTORM_REQUIRED_SECTIONS[kind]) {
    const headingIdx = lines.findIndex((l) => l.trim() === heading);
    if (headingIdx === -1) {
      return `${kind}.md missing: ${heading}`;
    }
    let hasContent = false;
    for (let i = headingIdx + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (line.startsWith("## ")) break;
      if (line.trim().length > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      return `${kind}.md missing: ${heading} (empty)`;
    }
  }
  return null;
}

function artifactMentionsSelectedMock(
  artifact: Artifact,
  mockId: string,
  requiredHeading: string,
): boolean {
  return artifact.body.includes(requiredHeading) && artifact.body.includes(`Selected mock: ${mockId}`);
}

export function makeMarkReadyTool(deps: {
  store: ArtifactsStore;
  bus: BrainstormEventBus;
  cwd: string;
  taskId: string;
  // Returns the count of un-consumed brainstorm_user_nudge events in the
  // current brainstorm.jsonl. mark_ready refuses while > 0 so the agent
  // can't ship with unaddressed user input. Injected (rather than read
  // directly) so tests can stub it without touching the filesystem.
  countPendingNudges: () => Promise<number>;
}): ToolLike<typeof MarkReadyParams, MarkReadyDetails> {
  const { store, bus, cwd, taskId, countPendingNudges } = deps;

  function reject(
    missing: string,
    detail: { kind?: BrainstormArtifactKind; path?: string } = {},
  ): ToolResult<MarkReadyDetails> {
    const location = detail.path ? ` (${detail.path})` : "";
    return {
      content: [{ type: "text", text: `${missing}${location}` }],
      details: { ok: false, missing, ...detail },
    };
  }

  return {
    name: "mark_ready",
    label: "Mark artifacts ready",
    description:
      "Signal that design.md and spec.md are complete. The harness validates required sections and either accepts (status flips to ready) or returns a structured error describing what to fix.",
    parameters: MarkReadyParams,
    async execute() {
      // Refuse mark_ready while the user has un-addressed nudges. The agent
      // must reply / write_artifact / submit_questions for each pending nudge before
      // it can flip the artifacts to ready — otherwise the user's most recent
      // input is silently dropped on the floor when the gate flips.
      const pending = await countPendingNudges();
      if (pending > 0) {
        const msg = `${pending} pending user nudge(s) — address them via reply_to_user / write_artifact / submit_questions before mark_ready`;
        return reject(msg);
      }

      const kinds: BrainstormArtifactKind[] = ["design", "spec"];
      const loaded: Record<BrainstormArtifactKind, Artifact> = {} as Record<
        BrainstormArtifactKind,
        Artifact
      >;

      for (const kind of kinds) {
        const path = store.artifactPath(cwd, taskId, kind);
        const art = await store.readArtifact(cwd, taskId, kind);
        if (!art) return reject(`${kind}.md not found`, { kind, path });
        if (art.fm.status !== "draft" && art.fm.status !== "ready") {
          return reject(`${kind}.md frontmatter status invalid (got: ${art.fm.status})`, {
            kind,
            path,
          });
        }
        loaded[kind] = art;
      }

      for (const kind of kinds) {
        const missing = findMissingSection(kind, loaded[kind].body);
        if (missing) return reject(missing, { kind, path: store.artifactPath(cwd, taskId, kind) });
      }

      if (hasWebResearch(cwd, taskId) && !loaded.design.body.includes("## External research")) {
        return reject("design.md missing: ## External research", {
          kind: "design",
          path: store.artifactPath(cwd, taskId, "design"),
        });
      }

      const mockManifest = await store.readBrainstormMockManifest(cwd, taskId);
      if (mockManifest.mocks.length > 0) {
        const selected = mockManifest.selectedMockId;
        const selectedReflected =
          selected !== null &&
          artifactMentionsSelectedMock(loaded.design, selected, "## Selected UI direction") &&
          artifactMentionsSelectedMock(loaded.spec, selected, "## UI acceptance criteria");
        if (!selectedReflected) {
          return reject("selected mock missing from design.md and spec.md");
        }
      }

      const alreadyReady = kinds.every((k) => loaded[k].fm.status === "ready");
      if (alreadyReady) {
        return {
          content: [{ type: "text", text: "ready" }],
          details: { ok: true },
          terminate: true,
        };
      }

      const now = new Date().toISOString();
      for (const kind of kinds) {
        const cur = loaded[kind];
        const next: Artifact = {
          fm: {
            ...cur.fm,
            status: "ready",
            last_updated: now,
            last_updated_by: "brainstorm-agent",
          },
          body: cur.body,
        };
        await store.writeArtifact(cwd, taskId, next);
      }

      await bus.publish({
        kind: "brainstorm_system",
        systemKind: "status_changed",
        data: { status: "ready" },
      });

      return {
        content: [{ type: "text", text: "ready" }],
        details: { ok: true },
        terminate: true,
      };
    },
  };
}

function hasWebResearch(cwd: string, taskId: string): boolean {
  return existsSync(
    join(cwd, ".harness", taskId, "brainstorm-research", "web-search-researcher.md"),
  );
}

type SubmitMocksDetails = { ok: boolean; proposed?: string[]; violations?: unknown };
type SubmitMockRevisionDetails = { ok: boolean; revised?: string; violations?: unknown };

function hasDesignEvidence(input: { readonly evidence?: readonly string[] }): boolean {
  return input.evidence !== undefined && input.evidence.some((item) => item.trim().length > 0);
}

function rejectMissingEvidence(mockId: string): ToolResult<SubmitMocksDetails> {
  return {
    content: [{ type: "text", text: "rejected: cite current UI design evidence before submitting mocks" }],
    details: { ok: false, violations: { mockId, missing: "evidence" } },
    terminate: true,
  };
}

function rejectRevisionMissingEvidence(mockId: string): ToolResult<SubmitMockRevisionDetails> {
  return {
    content: [{ type: "text", text: "rejected: cite current UI design evidence before submitting a mock revision" }],
    details: { ok: false, violations: { mockId, missing: "evidence" } },
    terminate: true,
  };
}

export function makeSubmitMocksTool(deps: {
  store: Pick<ArtifactsStore, "writeBrainstormMock" | "writeBrainstormMockRender">;
  designSystem: Pick<DesignSystemStore, "read" | "readDraftTokens">;
  renderer: Pick<MockRenderer, "render">;
  bus: BrainstormEventBus;
  cwd: string;
  taskId: string;
}): ToolLike<typeof SubmitMockChoicesParams, SubmitMocksDetails> {
  return {
    name: "submit_mocks",
    label: "Submit mocks",
    description:
      "Write one or more mock choices as HTML that consumes the project design tokens (var(--…)). The dashboard renders the saved HTML directly. After calling this, halt your turn.",
    parameters: SubmitMockChoicesParams,
    async execute(_id, params) {
      for (const mock of params.mocks) {
        if (!hasDesignEvidence(mock)) return rejectMissingEvidence(mock.mockId);
      }
      // Validate every page across every mock BEFORE any render or persist
      // side-effect. A single hard-coded core token rejects the whole call so
      // the agent gets a clean retry with no partially-written mock set.
      for (const mock of params.mocks) {
        for (const page of mock.pages) {
          const violations = findTokenViolations(page.html);
          if (violations.length > 0) {
            return {
              content: [
                { type: "text", text: "rejected: hard-coded core tokens; use var(--…)" },
              ],
              details: {
                ok: false,
                violations: { mockId: mock.mockId, pageId: page.pageId, violations },
              },
              terminate: true,
            };
          }
        }
      }

      const ds = await deps.designSystem.read(deps.cwd);
      const tokensCss = ds.exists ? ds.tokensCss : await deps.designSystem.readDraftTokens(deps.cwd, deps.taskId);
      const mockSetId = `mset_${randomUUID()}`;
      const proposed: string[] = [];
      for (const input of params.mocks) {
        const mock: BrainstormMock = {
          mockId: input.mockId,
          title: input.title,
          summary: input.summary,
          recommended: input.recommended,
          createdAt: new Date().toISOString(),
          evidence: input.evidence,
          ...(input.contextSummary !== undefined ? { contextSummary: input.contextSummary } : {}),
          ...(input.miniature !== undefined ? { miniature: input.miniature } : {}),
          pages: input.pages.map((page) => ({
            pageId: page.pageId,
            title: page.title,
            ...(page.summary !== undefined ? { summary: page.summary } : {}),
            htmlPath: `.harness/${deps.taskId}/mocks/${input.mockId}/${page.pageId}.html`,
            desktopPngPath: `.harness/${deps.taskId}/mocks/${input.mockId}/${page.pageId}.desktop.png`,
            mobilePngPath: `.harness/${deps.taskId}/mocks/${input.mockId}/${page.pageId}.mobile.png`,
          })),
        };
        await deps.store.writeBrainstormMock(
          deps.cwd,
          deps.taskId,
          mock,
          input.pages.map((page) => ({ pageId: page.pageId, html: page.html })),
        );
        for (const page of input.pages) {
          const png = await deps.renderer.render({ html: page.html, tokensCss });
          await deps.store.writeBrainstormMockRender(
            deps.cwd,
            deps.taskId,
            input.mockId,
            page.pageId,
            png,
          );
        }
        await deps.bus.publish({
          kind: "brainstorm_mock_proposed",
          mockSetId,
          mock,
        });
        proposed.push(input.mockId);
      }
      return {
        content: [{ type: "text", text: "submitted mocks" }],
        details: { ok: true, proposed },
        terminate: true,
      };
    },
  };
}

export function makeSubmitMockRevisionTool(deps: {
  store: Pick<
    ArtifactsStore,
    "writeBrainstormMock" | "writeBrainstormMockRender" | "readBrainstormMockManifest"
  >;
  designSystem: Pick<DesignSystemStore, "read" | "readDraftTokens">;
  renderer: Pick<MockRenderer, "render">;
  bus: BrainstormEventBus;
  cwd: string;
  taskId: string;
}): ToolLike<typeof WriteMockRevisionParams, SubmitMockRevisionDetails> {
  return {
    name: "submit_mock_revision",
    label: "Submit mock revision",
    description:
      "Write a revised mock as HTML that consumes the project design tokens (var(--…)) after the user requested edits to an existing mock. The dashboard renders the saved HTML directly. After calling this, halt your turn.",
    parameters: WriteMockRevisionParams,
    async execute(_id, params) {
      if (!hasDesignEvidence(params)) return rejectRevisionMissingEvidence(params.sourceMockId);
      // Reject hard-coded core tokens before reading the manifest or rendering.
      for (const page of params.pages) {
        const violations = findTokenViolations(page.html);
        if (violations.length > 0) {
          return {
            content: [{ type: "text", text: "rejected: hard-coded core tokens; use var(--…)" }],
            details: { ok: false, violations: { pageId: page.pageId, violations } },
            terminate: true,
          };
        }
      }

      const manifest = await deps.store.readBrainstormMockManifest(deps.cwd, deps.taskId);
      const mockId = nextRevisionMockId(
        params.sourceMockId,
        manifest.mocks.map((mock) => mock.mockId),
      );
      const ds = await deps.designSystem.read(deps.cwd);
      const tokensCss = ds.exists ? ds.tokensCss : await deps.designSystem.readDraftTokens(deps.cwd, deps.taskId);
      const mockSetId = `mset_${randomUUID()}`;
      const mock: BrainstormMock = {
        mockId,
        title: params.title,
        summary: params.summary,
        recommended: false,
        derivedFrom: params.sourceMockId,
        createdAt: new Date().toISOString(),
        evidence: params.evidence,
        ...(params.contextSummary !== undefined ? { contextSummary: params.contextSummary } : {}),
        ...(params.miniature !== undefined ? { miniature: params.miniature } : {}),
        pages: params.pages.map((page) => ({
          pageId: page.pageId,
          title: page.title,
          ...(page.summary !== undefined ? { summary: page.summary } : {}),
          htmlPath: `.harness/${deps.taskId}/mocks/${mockId}/${page.pageId}.html`,
          desktopPngPath: `.harness/${deps.taskId}/mocks/${mockId}/${page.pageId}.desktop.png`,
          mobilePngPath: `.harness/${deps.taskId}/mocks/${mockId}/${page.pageId}.mobile.png`,
        })),
      };
      await deps.store.writeBrainstormMock(
        deps.cwd,
        deps.taskId,
        mock,
        params.pages.map((page) => ({ pageId: page.pageId, html: page.html })),
      );
      for (const page of params.pages) {
        const png = await deps.renderer.render({ html: page.html, tokensCss });
        await deps.store.writeBrainstormMockRender(
          deps.cwd,
          deps.taskId,
          mockId,
          page.pageId,
          png,
        );
      }
      await deps.bus.publish({
        kind: "brainstorm_mock_revised",
        mockSetId,
        mock,
        editRequestId: params.editRequestId,
      });
      return {
        content: [{ type: "text", text: "wrote mock revision" }],
        details: { ok: true, revised: mockId },
        terminate: true,
      };
    },
  };
}

// Free-form prose reply from the agent to the user. Unlike submit_questions
// this is a side-effect tool — it does NOT terminate the turn. The agent is
// expected to call reply_to_user as a courtesy when the user's nudge contains
// a question or wants status, then continue the turn with the actual work
// (write artifacts, submit_questions, mark_ready). The dashboard renders
// these in the brainstorm transcript as chat bubbles.
export function makeReplyToUserTool(deps: {
  bus: BrainstormEventBus;
}): ToolLike<typeof ReplyToUserParams, ReplyToUserDetails> {
  return {
    name: "reply_to_user",
    label: "Reply to user",
    description:
      "Send a short prose reply to the user, surfaced in the brainstorm transcript. Use this when the user's nudge asks a question or wants status. Does NOT end your turn — keep working after the reply.",
    parameters: ReplyToUserParams,
    async execute(_id, params) {
      const replyId = `r_${randomUUID()}`;
      await deps.bus.publish({
        kind: "brainstorm_agent_reply",
        replyId,
        message: params.message,
        ...(params.inReplyToNudgeId !== undefined
          ? { inReplyToNudgeId: params.inReplyToNudgeId }
          : {}),
      });
      return {
        content: [{ type: "text", text: "replied" }],
        details: { replyId },
        // Intentionally not terminating — replying is a side-effect, not a
        // halt. The agent should follow up with submit_questions / write /
        // mark_ready.
      };
    },
  };
}
