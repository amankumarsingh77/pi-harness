import { Type, type Static, type TSchema } from "typebox";
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

export type SubmitQuestionsDetails = { awaiting: string[] };
export type MarkReadyDetails = { ok: boolean; missing?: string };

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
      for (const q of params.questions) {
        await deps.bus.publish({
          kind: "brainstorm_question",
          questionId: q.questionId,
          prompt: q.prompt,
          options: q.options,
          sectionTarget: q.sectionTarget,
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

const REQUIRED_SECTIONS: Record<ArtifactKind, string[]> = {
  design: ["## Goals", "## Trade-offs", "## Alternatives considered"],
  spec: ["## Verification scenarios", "## Acceptance criteria"],
};

// Returns the first missing-section error string, or null if all sections are
// present with non-empty bodies. A section's body runs from immediately after
// the heading line to the next line beginning with "## " (or EOF). "Empty"
// means no non-whitespace character appears in that range.
function findMissingSection(kind: ArtifactKind, body: string): string | null {
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
}): ToolLike<typeof MarkReadyParams, MarkReadyDetails> {
  const { store, bus, cwd, taskId } = deps;

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
      const kinds: ArtifactKind[] = ["design", "spec"];
      const loaded: Record<ArtifactKind, Artifact> = {} as Record<ArtifactKind, Artifact>;

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
