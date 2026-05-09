import type { BrainstormOption } from "@pi-harness/shared";

// Static script driving the mocked brainstorm subagent. Each step is one
// thing the mock "agent" emits; the run-loop walks this list, halting on
// `question` until the user answers (their answer arrives via the
// transitions endpoint, lands in JSONL, and the cursor advances).
//
// TODO(real-bridge): replace with a real @earendil-works/pi-coding-agent
// invocation once pi-bridge stops being mocked.
// One question's worth of script content. Used both by the singular
// `question` step and the batched `questions` step.
export type QuestionStep = {
  id: string;
  prompt: string;
  options: BrainstormOption[];
  sectionTarget: { artifact: "design" | "spec"; section: string };
  answerToBody: (answer: BrainstormAnswer) => string;
  /** When true, the user may pick multiple options for this question. */
  multiSelect?: boolean;
};

export type ScriptStep =
  | { kind: "probe" }
  | ({ kind: "question" } & QuestionStep)
  // Batched questions — emitted in one tick. The agent halts only when AT
  // LEAST one in the batch is unanswered. The user may answer them in any
  // order; the cursor advances past the batch when ALL are answered.
  | { kind: "questions"; questions: QuestionStep[] }
  | { kind: "self_critique" }
  | { kind: "ready" };

export type BrainstormAnswer = {
  questionId: string;
  optionId?: string;
  /** Multi-select answer. Either optionId OR optionIds is set, never both. */
  optionIds?: string[];
  freeText?: string;
};

const opt = (
  id: string,
  label: string,
  recommended: boolean,
  evidence: string[] = [],
): BrainstormOption => ({ id, label, recommended, evidence });

// 5 questions total. Designed to exercise the dashboard UI: each has a
// recommended option, evidence with file:line citations, and answers
// translate into concrete artifact body text (so design.md / spec.md grow
// section-by-section as the user answers).
export const BRAINSTORM_SCRIPT: ScriptStep[] = [
  { kind: "probe" },

  {
    kind: "question",
    id: "q_scope",
    prompt: "What's the intended scope?",
    options: [
      opt("narrow", "Single area, minimal blast radius", true, ["src/index.ts:1"]),
      opt("broad", "Cross-cutting refactor", false, []),
      opt("spike", "Spike to learn the shape, then split", false, []),
    ],
    sectionTarget: { artifact: "design", section: "Goals" },
    answerToBody: (a) =>
      a.optionId === "narrow"
        ? "Scope is narrow — a single area with minimal blast radius."
        : a.optionId === "broad"
        ? "Scope is broad — cross-cutting refactor."
        : a.optionId === "spike"
        ? "Scope is a spike, to be split after learnings."
        : a.freeText ?? "Scope unspecified.",
  },

  {
    kind: "question",
    id: "q_constraint",
    prompt: "What's the primary constraint?",
    options: [
      opt("correctness", "Correctness first; perf can come later", true, ["docs/superpowers/specs/2026-05-08-pi-harness-design.md:1"]),
      opt("perf", "Performance is the bottleneck", false, []),
      opt("dx", "Developer experience / API ergonomics", false, []),
    ],
    sectionTarget: { artifact: "design", section: "Trade-offs" },
    answerToBody: (a) =>
      a.optionId === "correctness"
        ? "Primary constraint: correctness. Performance optimizations are deferred."
        : a.optionId === "perf"
        ? "Primary constraint: performance."
        : a.optionId === "dx"
        ? "Primary constraint: developer experience and API ergonomics."
        : a.freeText ?? "Constraint unspecified.",
  },

  {
    kind: "question",
    id: "q_alternative",
    prompt: "Which alternative did you consider and reject?",
    options: [
      opt("inline", "Inline the change at the call sites", false, []),
      opt("abstract", "Build a reusable abstraction", true, ["packages/shared/src/index.ts:1"]),
      opt("third_party", "Adopt a third-party library", false, []),
    ],
    sectionTarget: { artifact: "design", section: "Alternatives considered" },
    answerToBody: (a) =>
      a.optionId === "inline"
        ? "Alternative: inline at call sites — rejected for poor reusability."
        : a.optionId === "abstract"
        ? "Alternative chosen: build a reusable abstraction. Inline duplication rejected."
        : a.optionId === "third_party"
        ? "Alternative: adopt a third-party library — rejected for boundary cost."
        : a.freeText ?? "Alternative unspecified.",
  },

  // Batched step: the agent emits both questions in one tick and halts only
  // when both are answered. Demonstrates the multi-question UX the dashboard
  // already renders (each question gets its own QuestionCard).
  {
    kind: "questions",
    questions: [
      {
        id: "q_verification",
        prompt: "How will we verify the change?",
        options: [
          opt("unit_only", "Unit tests only", false, []),
          opt("unit_e2e", "Unit + integration + an end-to-end smoke", true, ["apps/orchestrator/test/run-loop.test.ts:1"]),
          opt("manual", "Manual verification only", false, []),
        ],
        sectionTarget: { artifact: "spec", section: "Verification scenarios" },
        answerToBody: (a) =>
          a.optionId === "unit_only"
            ? "Verification: unit tests."
            : a.optionId === "unit_e2e"
            ? "Verification: unit + integration + one end-to-end smoke scenario."
            : a.optionId === "manual"
            ? "Verification: manual."
            : a.freeText ?? "Verification approach unspecified.",
      },
      {
        id: "q_acceptance",
        prompt: "What's the headline acceptance criterion?",
        options: [
          opt("functional", "Functional behaviour visible to a user", true, []),
          opt("contract", "API contract holds under test", false, []),
          opt("perf_budget", "Stays within a perf budget", false, []),
        ],
        sectionTarget: { artifact: "spec", section: "Acceptance criteria" },
        answerToBody: (a) =>
          a.optionId === "functional"
            ? "When the user performs the documented flow, the system shall produce the expected outcome end-to-end."
            : a.optionId === "contract"
            ? "When the system is exercised through its public API, the documented contract shall hold."
            : a.optionId === "perf_budget"
            ? "While under load, the system shall stay within the agreed performance budget."
            : a.freeText ?? "Acceptance criterion unspecified.",
      },
    ],
  },

  { kind: "self_critique" },
  { kind: "ready" },
];

// Number of individual questions across all script steps (single + batched).
// Used by tests / cursor logic.
export const SCRIPT_QUESTION_COUNT = BRAINSTORM_SCRIPT.reduce((n, s) => {
  if (s.kind === "question") return n + 1;
  if (s.kind === "questions") return n + s.questions.length;
  return n;
}, 0);
