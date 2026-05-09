# Phase 3: Brainstorm tools — `submit_questions` and `mark_ready`

> **Status:** pending

## Overview

After this phase the orchestrator has two TypeBox-defined custom tools that the brainstorm pi session can register. They are pure functions of `BrainstormEventBus` + `ArtifactsStore` + `taskId` — no session state, no resume logic. Phase 4 wires them in.

Keeping them in their own phase + file makes them independently testable: a tool's contract is "given input, mutate state and return a result"; the session machinery isn't involved.

## Implementation

**Files:**
- Create: `apps/orchestrator/src/agents/brainstorm-tools.ts`
- Test: `apps/orchestrator/src/agents/brainstorm-tools.test.ts`
- Modify: `subagents/ours/brainstorm.md` — rewrite to instruct the agent to use these tools (specifies the `submit_questions` schema, the `mark_ready` precondition, the artifact paths, and the `read`/`write`-only tool surface).

**Pattern to follow:** `apps/orchestrator/src/agents/brainstorm-event-bus.ts:36` for closure over `bus` + `taskId`; `apps/orchestrator/src/agents/artifacts-store.ts` for artifact reads.

**What to build:**

```ts
import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition, AgentToolResult } from "@earendil-works/pi-coding-agent";

const SubmitQuestionsParams = Type.Object({
  questions: Type.Array(Type.Object({
    questionId: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    options: Type.Array(Type.Object({
      id: Type.String(),
      label: Type.String(),
      recommended: Type.Boolean(),
      evidence: Type.Array(Type.String()),
    }), { minItems: 2 }),
    sectionTarget: Type.Object({
      artifact: Type.Union([Type.Literal("design"), Type.Literal("spec")]),
      section: Type.String(),
    }),
    multiSelect: Type.Optional(Type.Boolean()),
  }), { minItems: 1 }),
});

export function makeSubmitQuestionsTool(deps: {
  bus: BrainstormEventBus;
}): ToolDefinition<typeof SubmitQuestionsParams, { awaiting: string[] }> { ... }

export function makeMarkReadyTool(deps: {
  store: ArtifactsStore;
  bus: BrainstormEventBus;
  cwd: string;
  taskId: string;
}): ToolDefinition<typeof Type.Object({}), { ok: boolean; missing?: string }> { ... }
```

**`submit_questions` handler:**
1. Validate (TypeBox does this; on parse failure the SDK passes the error to the agent).
2. For each question: `await bus.publish({ kind: "brainstorm_question", questionId, prompt, options, sectionTarget, ...(multiSelect ? { multiSelect: true } : {}) })`. Idempotent on re-call (existing `hasQuestionEvent` dedupe lives in the bus's downstream consumers — confirm).
3. Return `{ content: [{ type: "text", text: "submitted" }], details: { awaiting: questions.map(q => q.questionId) }, terminate: true }`.

**`mark_ready` handler — contract check:**
1. `design = await store.readArtifact(cwd, taskId, "design")`. Missing → return `{ content: [{ type: "text", text: "design.md not found" }], details: { ok: false, missing: "design.md" } }` (NO `terminate` — let the agent retry).
2. Same for `spec.md`.
3. Frontmatter check (already done by `readArtifact` returning a typed `Artifact`; if `fm.status !== "draft"` and !== "ready", reject with `"design.md frontmatter status invalid"`).
4. Required-section check via simple regex over the body:
   - design.md: `## Goals`, `## Trade-offs`, `## Alternatives considered` — heading line + at least one non-whitespace line beneath it before the next `##`.
   - spec.md: `## Verification scenarios`, `## Acceptance criteria`.
5. First missing section → return `{ details: { ok: false, missing: "spec.md missing: ## Acceptance criteria" } }`. Surface one error at a time; the agent fixes and retries.
6. All present → for each artifact, write back with `fm.status = "ready"`, `fm.last_updated_by = "brainstorm-agent"`. Publish `bus.publish({ kind: "brainstorm_system", systemKind: "status_changed", data: { status: "ready" } })`. Return `{ details: { ok: true }, terminate: true }`.

**What to test:**
- `submit_questions` validates a single-question array and publishes one `brainstorm_question` event with all fields propagated.
- `submit_questions` with multiSelect=true publishes the flag.
- `submit_questions` with empty `questions` rejected by TypeBox (verify by attempting; the SDK contract is that handler isn't called).
- `mark_ready` returns `missing: "design.md"` when the artifact doesn't exist; does NOT publish `status_changed`; does NOT `terminate`.
- `mark_ready` returns `missing: "spec.md missing: ## Acceptance criteria"` when the section heading is absent.
- `mark_ready` returns `missing: "...empty"` when the section heading is present but body is whitespace-only (one specific section per test, one empty-body test).
- `mark_ready` happy path: reads two valid artifacts, writes both back with `status: ready`, publishes `status_changed`, returns `terminate: true`.
- Idempotency: calling `mark_ready` twice in a row is safe — second call sees `status: ready` and short-circuits to success without re-publishing `status_changed`.

**Commit:** `feat(orchestrator): brainstorm submit_questions + mark_ready tools`

## Done When

- [ ] All tool unit tests pass with no real SDK / session involvement (handlers are called directly).
- [ ] `subagents/ours/brainstorm.md` describes the new protocol; `EXPECTED_OUR_AGENTS` boot validation still passes.
- [ ] `pnpm --filter @pi-harness/orchestrator test` passes.
- [ ] No regression in existing tests.

## E2E Verification

Not applicable — internal handlers. End-to-end exercising happens in Phase 6.
