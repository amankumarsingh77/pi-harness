# Phase 1: Worktree Wiring + Scaffolding Commit

> **Status:** pending

## Overview

After this phase, the moment a task transitions into the brainstorm phase the orchestrator cuts branch `pi/T-NNN`, materializes a worktree at `.harness/worktrees/<taskId>/`, writes empty `design.md` and `spec.md` with `status: draft` frontmatter at `<worktree>/.harness/T-NNN/`, and lands a `chore(T-NNN): brainstorm scaffolding` commit on the branch. All phase handlers receive the worktree path as `cwd` — closes the CLAUDE.md "WorktreeManager isn't wired into run-loop yet" gap.

This phase deliberately does *not* run the subagent, write JSONL, or surface anything in the UI — it just establishes the worktree-first invariant the rest of the plan depends on.

## Implementation

**Files:**
- Modify: `apps/orchestrator/src/runner/run-loop.ts` — before calling `runPhase()`, ensure worktree exists for the task; pass worktree path through `PhaseInput`.
- Modify: `apps/orchestrator/src/runner/phase-prompts.ts` — extend `PhaseInput`/`PhaseDeps` with `cwd: string`; thread into every phase handler signature.
- Modify: `apps/orchestrator/src/index.ts` and the server bootstrap — pass `WorktreeManager` into `PhaseDeps` (today it's constructed but only used by the janitor).
- Modify: `apps/orchestrator/src/adapters/worktree.ts` — add `ensure({ taskId, branchName })` that's idempotent: returns existing worktree if present, creates otherwise. Keep canonicalization rules intact.
- Create: `apps/orchestrator/src/runner/scaffold-brainstorm.ts` — pure function `scaffoldBrainstorm({ cwd, taskId, branch }): Promise<void>` that writes the two empty artifacts with frontmatter and runs `git add . && git commit`. Frontmatter shape comes from Phase 2 — for now use a minimal inline writer; refactor in Phase 2.
- Modify: `apps/orchestrator/src/runner/run-loop.ts` — call `scaffoldBrainstorm` once per task on first entry into the brainstorm phase (idempotent: check for existing `.harness/T-NNN/design.md` first).
- Test: `apps/orchestrator/src/adapters/worktree.test.ts` — extend with `ensure()` idempotency tests.
- Test: `apps/orchestrator/src/runner/scaffold-brainstorm.test.ts` — new.
- Test: `apps/orchestrator/src/runner/run-loop.test.ts` — extend to assert worktree is created on brainstorm entry, cwd is threaded through.

**Pattern to follow:** existing `WorktreeManager.create()` for git mechanics; existing run-loop test fixtures for orchestrating a fake phase pass.

**What to test:**
- `WorktreeManager.ensure()` is idempotent — calling twice returns same path, doesn't error.
- Branch name follows `pi/T-NNN` (the existing `taskId` format).
- After scaffold, `<worktree>/.harness/T-NNN/design.md` and `spec.md` exist with `status: draft` frontmatter.
- A commit lands on `pi/T-NNN` with subject `chore(T-NNN): brainstorm scaffolding`.
- `runPhase` receives the worktree path as `cwd` — assert via spy/mock on the dispatcher.
- macOS path canonicalization still works (the `realpathSync` resolution at ensure time).
- Existing brainstorm mock continues to pass (no regression in run-loop tests).

**Traces to:** Decisions #2, #3 from design doc.

**What to build:**

`scaffoldBrainstorm` is straightforward:
```
1. mkdir -p <cwd>/.harness/<taskId>
2. write design.md with frontmatter { task, kind: design, parent: null, status: draft, branch, last_updated, last_updated_by: orchestrator }
3. write spec.md with frontmatter { task, kind: spec, parent: design.md, status: draft, ... }
4. git -C <cwd> add .harness/<taskId> && git -C <cwd> commit -m "chore(<taskId>): brainstorm scaffolding"
```

For the frontmatter writer in this phase, hand-roll a tiny string template (10 lines). Phase 2 replaces it with the proper helper. Add a `// TODO(phase-2): replace with frontmatter helper` comment.

For the run-loop integration: the existing brainstorm handler at `phase-prompts.ts:55` will keep its current behavior — this phase only wraps the entry. The handler stops running in `process.cwd()` and starts running in the worktree.

**Commit:** `feat(orchestrator): wire worktree creation into brainstorm phase entry`

## Done When

- [ ] `pnpm --filter @pi-harness/orchestrator test` passes.
- [ ] `pnpm typecheck` passes across the workspace.
- [ ] Manually filing a task and triggering brainstorm produces a `pi/T-NNN` branch + worktree with the scaffolding commit (verify with `git -C .harness/worktrees/<taskId> log`).
- [ ] All phase handlers receive `cwd` (verified by inspecting `phase-prompts.ts` signatures).
- [ ] CLAUDE.md "Known gaps" entry for "WorktreeManager isn't wired into run-loop yet" is removed in this commit (or flagged for removal in Phase 6's docs sync).
