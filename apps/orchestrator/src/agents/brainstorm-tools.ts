import { Type, type Static, type TSchema } from "typebox";
import { randomUUID } from "node:crypto";
import type { Artifact, ArtifactKind } from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { BrainstormEventBus } from "./brainstorm-event-bus.js";

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

const MarkReadyParams = Type.Object({});

const ReplyToUserParams = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  inReplyToNudgeId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

export type SubmitQuestionsDetails = { awaiting: string[] };
export type MarkReadyDetails = { ok: boolean; missing?: string };
export type ReplyToUserDetails = { replyId: string };

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

// Brainstorm writes only `design` and `spec`. Plan/scenarios are owned by
// the plan phase and have their own required-section check there.
type BrainstormArtifactKind = Extract<ArtifactKind, "design" | "spec">;

const REQUIRED_SECTIONS: Record<BrainstormArtifactKind, string[]> = {
  design: ["## Goals", "## Trade-offs", "## Alternatives considered"],
  spec: ["## Verification scenarios", "## Acceptance criteria"],
};

// Returns the first missing-section error string, or null if all sections are
// present with non-empty bodies. A section's body runs from immediately after
// the heading line to the next line beginning with "## " (or EOF). "Empty"
// means no non-whitespace character appears in that range.
function findMissingSection(kind: BrainstormArtifactKind, body: string): string | null {
  const lines = body.split("\n");
  for (const heading of REQUIRED_SECTIONS[kind]) {
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

  function reject(missing: string): ToolResult<MarkReadyDetails> {
    return {
      content: [{ type: "text", text: missing }],
      details: { ok: false, missing },
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
      // must reply / write / submit_questions for each pending nudge before
      // it can flip the artifacts to ready — otherwise the user's most recent
      // input is silently dropped on the floor when the gate flips.
      const pending = await countPendingNudges();
      if (pending > 0) {
        const msg = `${pending} pending user nudge(s) — address them via reply_to_user / write / submit_questions before mark_ready`;
        return reject(msg);
      }

      const kinds: BrainstormArtifactKind[] = ["design", "spec"];
      const loaded: Record<BrainstormArtifactKind, Artifact> = {} as Record<
        BrainstormArtifactKind,
        Artifact
      >;

      for (const kind of kinds) {
        const art = await store.readArtifact(cwd, taskId, kind);
        if (!art) return reject(`${kind}.md not found`);
        if (art.fm.status !== "draft" && art.fm.status !== "ready") {
          return reject(`${kind}.md frontmatter status invalid (got: ${art.fm.status})`);
        }
        loaded[kind] = art;
      }

      for (const kind of kinds) {
        const missing = findMissingSection(kind, loaded[kind].body);
        if (missing) return reject(missing);
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
