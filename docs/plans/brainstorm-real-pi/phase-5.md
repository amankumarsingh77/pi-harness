# Phase 5: `phase_models` freeze enforcement

> **Status:** pending

## Overview

After this phase the orchestrator API rejects writes to `task.phaseModels` once any `runs` row exists for the task. This locks in per-task model choices at first dispatch and prevents mid-flight config drift. No UI surface for editing exists yet (deferred to its own slice); this phase just installs the guard so the future Intake-form work can rely on it.

Depends on Phase 4 (which is the first consumer that actually reads `task.phaseModels`).

## Implementation

**Files:**
- Modify: `apps/orchestrator/src/routes/<tasks-update>.ts` (or wherever `PATCH /tasks/:id` lives) — add the freeze check.
- Modify: `apps/orchestrator/src/adapters/run-store.ts` — expose `hasAnyRun(taskId): Promise<boolean>` if not already present.
- Modify: `packages/shared/src/errors.ts` (or co-located) — add `PhaseModelsFrozenError` if we surface a structured error type.
- Test: route-level test against in-memory or test-DB orchestrator.

**Pattern to follow:** how existing 4xx mappings are done in `apps/orchestrator/src/routes/*` and how the dashboard's proxy surfaces them.

**What to build:**

In the task-update handler:

```ts
if ("phaseModels" in patch) {
  if (await runs.hasAnyRun(taskId)) {
    return reply.code(409).send({
      error: "phase_models_frozen",
      message: "Cannot modify phaseModels after the task has started its first run.",
    });
  }
  // validate shape against PhaseModelConfig (Zod schema), then persist
}
```

Other patch fields are unaffected. The freeze applies only to `phaseModels`.

`hasAnyRun(taskId)` is a single `SELECT 1 FROM runs WHERE task_id = $1 LIMIT 1`.

**What to test:**
- PATCH `phaseModels` on a task with zero runs → 200, persisted.
- PATCH `phaseModels` on a task that has at least one run → 409 with `error: "phase_models_frozen"`.
- PATCH other fields (e.g. title) on a task with runs → 200 (other fields are not frozen).
- Concurrent: a task moving from zero-runs to one-run while a PATCH is in flight is acceptable to lose to the freeze (last writer wins; we don't need a transaction here).
- Validation: PATCH `phaseModels` with an unknown phase key → 400, never reaches the freeze check.

**Commit:** `feat(orchestrator): freeze phaseModels after first run`

## Done When

- [ ] Route tests pass.
- [ ] `pnpm --filter @pi-harness/orchestrator test` passes.
- [ ] Dashboard's existing task-edit flows (if any) don't regress — they shouldn't touch `phaseModels` today.

## E2E Verification

Not applicable yet — no UI exposes `phaseModels` for editing. The Intake-form follow-up slice will exercise this gate. For now, manual `curl` against the orchestrator is sufficient and is captured in the route tests.
