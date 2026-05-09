# Phase 4: Brainstorm Subagent (Scripted Q&A Mock)

> **Status:** pending

## Overview

After this phase, the brainstorm subagent — still mocked through `pi-bridge/_mock.ts` — emits a realistic multi-turn Q&A walkthrough that exercises every UI surface: probe-complete event, structured questions with options + `(Recommended)` + `file:line` evidence, waits for user answers (round-tripped through the dashboard), self-critique, status transition to `ready`. The mock writes to artifacts via `ArtifactsStore` and emits events through the `BrainstormEventBus` from Phase 2.

Real pi-bridge stays deferred per CLAUDE.md known gaps.

## Implementation

**Files:**
- Modify: `packages/pi-bridge/src/_mock.ts` — replace the current single-shot brainstorm mock with a stateful script. The mock is driven by an in-memory cursor: each `runSubagent` call advances the script until either (a) the script ends (status=ready) or (b) it hits a `wait_for_user` marker.
- Create: `packages/pi-bridge/src/_mock-script-brainstorm.ts` — the canned Q&A script. ~5 questions covering: scope, target files, primary constraint, alternative considered, verification approach. Each question has 2–4 options with one `(Recommended)` and 1–3 `file:line` citations pointing at fixture paths in the user's repo (read from `cwd`, fall back to placeholders if files don't exist).
- Modify: `apps/orchestrator/src/runner/phase-prompts.ts` — `runBrainstorm` handler:
  - On entry: scan `<cwd>/.harness/<taskId>/brainstorm.jsonl` for the latest `revision_requested` event. If present, restart the script from cursor 0 with the comment as additional context. Otherwise start fresh.
  - For each scripted event: publish via `BrainstormEventBus`, write incremental updates to `design.md` / `spec.md` body (the script declares which sections each answer fills).
  - Stops at `wait_for_user`: phase exits without advancing; user's answer arrives via the dashboard server action (Phase 5), which re-dispatches the run-loop, which calls `runBrainstorm` again with the cursor advanced.
- Create: `apps/orchestrator/src/runner/brainstorm-cursor.ts` — small helper that reads the JSONL to compute "where are we in the script" so the run-loop can resume correctly.
- Modify: `apps/orchestrator/src/agents/artifacts-store.ts` — add `appendToBody(taskId, kind, section, content)` for incremental artifact updates without replacing the whole body.
- Test: `packages/pi-bridge/src/_mock.test.ts` — script advances per-call, `wait_for_user` halts, revision restart reads from JSONL.
- Test: `apps/orchestrator/src/runner/phase-prompts.test.ts` — extend brainstorm tests: full script run produces both artifacts with `status: ready`, mid-script halt persists state, revision request restarts.
- Test: `apps/orchestrator/src/runner/brainstorm-cursor.test.ts` — cursor computation correctness on various JSONL states.

**Pattern to follow:**
- Existing `_mock.ts` already has the agent-emission shape (`onEvent` callback). Keep that contract; only the script content changes.
- Look at `apps/dashboard/lib/server/_fixtures/*` for the kind of Q&A content already mocked on the UI side — the new script should produce events whose payload shapes match what those fixtures imply.

**What to test:**
- First `runSubagent` call from a fresh worktree: emits `probe_complete` → first `question` event with options + evidence → halts at `wait_for_user`. JSONL has 2 lines.
- Second call after user submits an `answer` event: advances past the answer, emits next question, halts again.
- After last question + user answer: emits `self_critique_passed` → `status_changed: ready`. Both artifacts now have `status: ready` in frontmatter.
- After `revision_requested` lands in JSONL: next `runSubagent` call restarts script from cursor 0, preserves the existing JSONL (does not truncate), agent re-emits questions. Artifacts go back to `status: draft` until script completes again.
- Scripted evidence citations: when a referenced file exists in `cwd`, the citation passes through; when missing, mock substitutes a placeholder marker so the UI can still render. (Tests cover both branches.)

**Traces to:** Decisions #5, #6, #10 from design doc.

**What to build:**

Script shape:
```ts
// _mock-script-brainstorm.ts
type ScriptStep =
  | { kind: "probe"; ts?: string }
  | { kind: "question"; id: string; prompt: string; options: Option[]; sectionTarget: { artifact: "design" | "spec"; section: string } }
  | { kind: "self_critique" }
  | { kind: "ready" };

export const BRAINSTORM_SCRIPT: ScriptStep[] = [
  { kind: "probe" },
  { kind: "question", id: "q_scope", prompt: "What's the intended scope?", options: [
    { id: "narrow", label: "Single file change", recommended: true, evidence: ["src/index.ts:1"] },
    { id: "broad",  label: "Cross-cutting refactor", recommended: false, evidence: [] },
  ], sectionTarget: { artifact: "design", section: "Goals" } },
  // ... ~4 more
  { kind: "self_critique" },
  { kind: "ready" },
];
```

Cursor logic: replay JSONL, count `answer` events, compare against `question` events that require answers. Cursor = next script index after the last answered question.

Real-pi-bridge wiring is **out of scope**. Add a `// TODO(real-bridge): replace scripted mock with pi-coding-agent invocation` comment at the top of `_mock-script-brainstorm.ts`.

**Commit:** `feat(pi-bridge): scripted brainstorm Q&A mock with resumable cursor`

## Done When

- [ ] All new tests pass.
- [ ] Manually triggering a brainstorm task and submitting answers via curl to the transitions endpoint walks the script to completion; both artifacts end with `status: ready`.
- [ ] After a request-changes, the script restarts and JSONL preserves history (verified with `wc -l` on the JSONL — line count grows, never resets).
- [ ] No real `@earendil-works/pi-coding-agent` calls (grep confirms).
