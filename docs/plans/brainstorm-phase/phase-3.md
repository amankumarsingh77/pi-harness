# Phase 3: State Machine + Approval Gate (Backend)

> **Status:** pending

## Overview

After this phase, the orchestrator state machine recognizes the brainstorm approval gate as a sub-state of the brainstorm phase, accepts `user_approve_brainstorm` and `user_request_brainstorm_changes` actions, and refuses to advance to plan unless both artifacts have `status: approved`. A new REST endpoint exposes the artifact bundle to the dashboard.

Per design doc Decision #8: this is a *sub-state*, not a new entry in the `TASK_STATUSES` enum.

## Implementation

**Files:**
- Modify: `packages/shared/src/types/task.ts` — add optional `awaitingApproval: boolean` field to `Task`. Default false. Document as "true only while in brainstorm phase between `status: ready` and `status: approved`."
- Modify: `packages/db/src/schema.ts` — add `awaiting_approval` boolean column on `tasks` (default false, not null).
- Generate: `pnpm db:generate` migration for the new column. Hand-review the generated SQL before commit.
- Modify: `apps/orchestrator/src/domain/state-machine.ts`:
  - Add actions: `user_approve_brainstorm`, `user_request_brainstorm_changes` (carries required `comment: string`).
  - `user_approve_brainstorm`: legal only when status=`brainstorming` AND `awaitingApproval=true`. Effect: set both artifacts' frontmatter `status: approved`, clear `awaitingApproval`, advance to `planning`.
  - `user_request_brainstorm_changes`: legal only when status=`brainstorming` AND `awaitingApproval=true`. Effect: append `revision_requested` event to JSONL via the bus, clear `awaitingApproval` (agent will re-set it after revision), keep status=`brainstorming`, re-trigger run-loop dispatch.
- Modify: `apps/orchestrator/src/runner/run-loop.ts`:
  - On brainstorm phase end, do NOT auto-advance. Read both artifacts; if both have `status: ready`, set `awaitingApproval: true` and stop. If still draft, that's an agent error — log and fail the run.
- Modify: `apps/orchestrator/src/http/routes/tasks.ts`:
  - Extend transitions endpoint to accept the two new actions (validation via Zod).
  - For `user_request_brainstorm_changes`, require non-empty `comment` in body.
- Create: `apps/orchestrator/src/http/routes/brainstorm.ts` — `GET /api/tasks/:id/brainstorm` returns `{ design: Artifact | null, spec: Artifact | null, awaitingApproval: boolean }`. Reads artifacts from the worktree using `ArtifactsStore`.
- Modify: `apps/orchestrator/src/http/server.ts` — register the new route.
- Test: `apps/orchestrator/src/domain/state-machine.test.ts` — legal/illegal transitions for the two new actions; `awaitingApproval` lifecycle.
- Test: `apps/orchestrator/src/runner/run-loop.test.ts` — extend to assert no auto-advance when artifacts are `ready`; `awaitingApproval` set correctly.
- Test: `apps/orchestrator/src/http/routes/brainstorm.test.ts` — returns 200 with bundle, 404 when no artifacts yet, reflects `awaitingApproval`.
- Test: `apps/orchestrator/src/http/routes/tasks.test.ts` — both new actions accepted with valid bodies, rejected with invalid (missing comment, wrong state).

**Pattern to follow:**
- Existing `user_approve_plan` action in state-machine.ts is the closest precedent — copy its shape, adapt validation predicate.
- Existing `tasks.ts` transition handler validates with Zod; mirror that for the new actions.
- Drizzle migration pattern: see prior migrations in `packages/db/migrations/`.

**What to test:**
- `user_approve_brainstorm` from `brainstorming + awaitingApproval=true` → `planning`, `awaitingApproval=false`, both artifacts now have `status: approved`.
- `user_approve_brainstorm` from `brainstorming + awaitingApproval=false` → rejected (artifacts not ready yet).
- `user_request_brainstorm_changes` with empty comment → 400.
- `user_request_brainstorm_changes` valid → JSONL has `revision_requested` event, task remains in `brainstorming`, run-loop re-dispatches.
- `GET /api/tasks/:id/brainstorm` for a task that's never been to brainstorm → 404 (or empty bundle, pick one and document).
- Run-loop on brainstorm phase end: artifacts `ready` → no advance, `awaitingApproval=true`. Artifacts `draft` → log + fail.

**Traces to:** Decisions #7, #8, #9, #10 from design doc.

**What to build:**

State machine sketch:
```ts
// in state-machine.ts
"user_approve_brainstorm": {
  guard: (task) => task.status === "brainstorming" && task.awaitingApproval === true,
  effect: async (task, _action, ctx) => {
    await ctx.artifacts.setStatus(task.id, "design", "approved");
    await ctx.artifacts.setStatus(task.id, "spec", "approved");
    return { ...task, status: "planning", awaitingApproval: false };
  },
},
"user_request_brainstorm_changes": {
  guard: (task) => task.status === "brainstorming" && task.awaitingApproval === true,
  effect: async (task, action, ctx) => {
    await ctx.brainstormBus.publish({
      type: "revision_requested",
      ts: new Date().toISOString(),
      comment: action.comment,
    });
    return { ...task, awaitingApproval: false }; // agent will re-set when ready
  },
},
```

Add `ArtifactsStore.setStatus(taskId, kind, status)` helper — reads, mutates frontmatter, writes back, commits the change with message `chore(<taskId>): mark <kind> as <status>`.

The `awaitingApproval` field intentionally lives on Task (not Run) — even though we considered Run-level state, the design doc locked Task as the carrier (Decision #8: "sub-state of the brainstorm phase").

**Commit:** `feat(orchestrator): brainstorm approval gate with state-machine sub-state`

## Done When

- [ ] All new tests pass.
- [ ] `pnpm db:migrate` runs cleanly against a fresh database.
- [ ] `GET /api/tasks/:id/brainstorm` returns the expected shape (manually curl-verified).
- [ ] `pnpm typecheck` clean.
