# Phase 6: Live smoke + cleanup

> **Status:** pending

## Overview

After this phase a manually-runnable smoke test exercises the brainstorm flow against a real Anthropic key end-to-end, and all leftover scaffolding from the script-era is gone. This is the merge gate — once this passes, the rollout is real.

Depends on Phase 4 (the rewrite).

## Implementation

**Files:**
- Create: `apps/orchestrator/src/agents/brainstorm.live.test.ts` — `describe.runIf(process.env.PI_LIVE === "1")` exercising one full Q&A turn against real Claude.
- Create: `.env.harness.example` at repo root — documents the keys to put in `.env.harness` (which is gitignored).
- Modify: `.gitignore` — confirm `.env.harness` is listed; add if missing.
- Modify: `CLAUDE.md` — flip the "pi-bridge is mocked" gap entry to reflect that brainstorm is now real; update the brainstorm section's "Real `@earendil-works/pi-coding-agent` invocation is still deferred" note to "the brainstorm phase now uses the real SDK; plan/code/verify still on the legacy mock."
- Modify: `docs/superpowers/specs/2026-05-09-brainstorm-real-pi-design.md` — flip status from `draft` to `implemented`.
- Search and remove: any `TODO(real-bridge)` comments and any orphaned imports of the deleted `brainstorm-script`.

**What to build:**

The live smoke test is a single `it.runIf(process.env.PI_LIVE === "1")` that:
1. Creates a temp worktree (uses the existing `WorktreeManager` test helper).
2. Scaffolds the brainstorm artifacts.
3. Calls `runBrainstorm` with `phaseModel = DEFAULT_PHASE_MODELS.brainstorm` and a real bus + store.
4. Asserts: at least one `brainstorm_question` was published; `design.md` / `spec.md` are still `status: draft`; `costUsd > 0`.
5. Appends a synthetic `brainstorm_answer` for the first question.
6. Calls `runBrainstorm` again. Repeats until `ready: true` or 10 ticks elapse (whichever first).
7. Asserts: both artifacts now `status: ready`.

This test is excluded from CI (`vitest --exclude '**/*.live.test.ts'` or by inspecting `process.env.PI_LIVE`). Run command documented in CLAUDE.md: `PI_LIVE=1 pnpm --filter @pi-harness/orchestrator test brainstorm.live`.

**`.env.harness.example`:**

```
# Required for any phase using the anthropic provider.
ANTHROPIC_API_KEY=

# Add others as needed:
# OPENAI_API_KEY=
# GOOGLE_API_KEY=
```

**What to test:**

The live test is itself the test. No unit-test additions in this phase.

**What to verify manually:**
- `PI_LIVE=1 pnpm --filter @pi-harness/orchestrator test brainstorm.live` passes against a real key.
- Cost emitted is non-zero and looks plausible (cents, not dollars, for one Q&A round).
- pi-session.jsonl appears in the temp worktree and is non-empty.

**Commit:** `chore: live brainstorm smoke + docs cleanup`

## Done When

- [ ] `PI_LIVE=1 pnpm --filter @pi-harness/orchestrator test brainstorm.live` passes manually.
- [ ] `pnpm test` (without PI_LIVE) does not run the live test.
- [ ] CLAUDE.md "Known gaps" reflects the new state.
- [ ] No `TODO(real-bridge)` comments remain in the codebase.
- [ ] `.env.harness.example` exists; `.env.harness` is gitignored.
- [ ] Spec status flipped to `implemented`.

## E2E Verification

The live test is the end-to-end verification. Additionally, after merging:
- Run the dashboard locally, create a task, confirm the brainstorm phase actually streams real LLM-produced questions to the QuestionCards (not the fake adapter).
- Verify usage flows into the run row (`SELECT cost_usd, input_tokens, output_tokens FROM runs WHERE phase = 'brainstorm' ORDER BY started_at DESC LIMIT 1`).
