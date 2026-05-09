# Phase 6: End-to-End Wiring + Verification

> **Status:** pending

## Overview

Final integration phase. Bring up the full stack, file a fresh task in the browser, walk it through brainstorm using the scripted Q&A mock, hit Approve, confirm phase advances to plan. Repeat with Request changes to confirm the resume path. Capture screenshots/recordings as proof. Add an integration test that exercises the full flow against the mock subagent so this never silently regresses.

Also sweep documentation and remove obsolete known-gap entries.

## Implementation

**Files:**
- Create: `apps/orchestrator/test/integration/brainstorm-flow.test.ts` — full happy-path test: create task → run-loop dispatches brainstorm → mock emits questions → submit answers via state-machine actions → mock advances → ready → `awaitingApproval=true` → user_approve_brainstorm → task in `planning`. Run against real Postgres (use the existing `pool: forks` config).
- Create: `apps/orchestrator/test/integration/brainstorm-revision.test.ts` — request-changes path: ready → request_changes with comment → revision_requested in JSONL → run-loop re-dispatches → script restarts → ready again → approve.
- Modify: `CLAUDE.md`:
  - Remove "WorktreeManager isn't wired into run-loop yet" from Known gaps.
  - Update phase chain description if any wording references "no approval gate".
  - Add a short Brainstorm section under "Architecture" pointing to `docs/superpowers/specs/2026-05-09-brainstorm-phase-design.md` and the plan folder.
- Modify: `docs/dashboard-flow.md` if it references the old single-spec brainstorm shape.
- Browser verification: file a task in the dev dashboard, walk through all 5 questions, submit Approve, confirm dashboard reflects plan-phase status.

**Pattern to follow:**
- Integration tests: see existing tests under `apps/orchestrator/test/` for harness setup.
- Use `harness:functional-verify` skill for the live verification. Capture screenshots into `docs/spec/brainstorm-phase/verification/`.

**What to test:**
- Happy path: 5 questions, all answered, both artifacts end at `status: approved`, task transitions to `planning`. Run completes within reasonable time.
- Revision path: after `ready`, request-changes resets `awaitingApproval`, JSONL gains `revision_requested` event, re-dispatch resumes from cursor 0, ends at `ready` again with new content.
- Idempotency: triggering brainstorm twice for the same task does NOT create a second worktree or duplicate the scaffolding commit.
- Error path: orchestrator killed mid-question — on restart, script resumes from JSONL cursor without losing prior answers.
- SSE livestream: frontend `EventSource` receives all four event kinds; reducer state matches expected.

**Traces to:** All design doc Decisions; this phase verifies the contract holistically.

**What to build:**

Integration test sketch:
```ts
test("brainstorm happy path approves and advances to plan", async () => {
  const task = await createTask({ title: "Test brainstorm" });
  await runLoop.tick(); // dispatch brainstorm

  // Walk the scripted Q&A
  for (let i = 0; i < BRAINSTORM_SCRIPT_QUESTION_COUNT; i++) {
    const events = await readJsonl(task);
    const lastQuestion = events.findLast((e) => e.type === "question");
    expect(lastQuestion).toBeDefined();
    await transitionTask(task.id, {
      type: "user_answer_brainstorm",
      questionId: lastQuestion!.id,
      optionId: lastQuestion!.options[0].id,
    });
    await runLoop.tick();
  }

  const after = await getTask(task.id);
  expect(after.awaitingApproval).toBe(true);
  expect(after.status).toBe("brainstorming");

  await transitionTask(task.id, { type: "user_approve_brainstorm" });
  const final = await getTask(task.id);
  expect(final.status).toBe("planning");
  expect(final.awaitingApproval).toBe(false);

  const design = await readArtifact(task, "design");
  expect(design.fm.status).toBe("approved");
});
```

Browser verification checklist (with screenshots):
1. New task creation page submits successfully.
2. Kanban card appears in `brainstorming` column.
3. Detail page brainstorm tab renders empty artifact panes + first question.
4. Selecting `(Recommended)` option fires answer; next question appears within 1-2 seconds.
5. After last answer, both artifact panes show body content + `ready` badge; gate enables.
6. Approve → page redirects/reflects `planning` status; kanban card moves columns.
7. Re-do flow with Request changes (with comment) → confirm resume.

**Commit:** `chore(brainstorm): end-to-end integration tests + docs sync`

## Done When

- [ ] Both integration tests pass.
- [ ] `pnpm typecheck && pnpm test && pnpm lint && pnpm build` all green from a clean clone.
- [ ] Browser walkthrough screenshots committed under `docs/spec/brainstorm-phase/verification/`.
- [ ] CLAUDE.md updated; obsolete known-gap removed; new Architecture pointer added.
- [ ] `harness:sync-docs` skill run before commit (per project workflow).
- [ ] No regressions in existing orchestrator/dashboard test suites.
