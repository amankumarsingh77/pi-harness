# Phase 1: `phase_models` DB column + shared default config

> **Status:** pending

## Overview

After this phase the system has a typed, per-task store of `(provider, model, thinkingLevel, maxTurns)` for each phase, with code-level defaults that the orchestrator can merge in at dispatch time. No phase reads it yet — that wires up in Phase 4. The column is additive, defaults to `{}`, and is safe to deploy independently.

This phase is independent of Phase 2 and can run in parallel.

## Implementation

**Files:**
- Create: `packages/shared/src/config/phase-models.ts`
- Modify: `packages/shared/src/index.ts` — re-export `PhaseModelConfig`, `DEFAULT_PHASE_MODELS`, `mergePhaseModels`.
- Modify: `packages/shared/src/types/task.ts` — add `phaseModels: Record<Phase, Partial<PhaseModelConfig>>` to `Task`.
- Create: `packages/db/drizzle/<next-numeric>_phase_models.sql` — migration adding the column.
- Modify: `packages/db/src/schema.ts` — add `phaseModels` jsonb column with default `{}`.
- Modify: `apps/orchestrator/src/adapters/run-store.ts` (or wherever Task is mapped) — read/write the column.
- Test: `packages/shared/src/config/phase-models.test.ts` — defaults present for every Phase, merge semantics.

**Pattern to follow:** `packages/shared/src/types/run.ts` for typed const + union; `packages/db/drizzle/<existing>` for migration shape; existing Task field round-tripping in `run-store.ts`.

**What to build:**

`phase-models.ts` exports:

```ts
export const THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type PhaseModelConfig = {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  maxTurns: number;
};

export const DEFAULT_PHASE_MODELS: Record<Phase, PhaseModelConfig> = {
  brainstorm: { provider: "anthropic", model: "claude-sonnet-4-6", thinkingLevel: "medium", maxTurns: 30 },
  plan:       { provider: "anthropic", model: "claude-opus-4-7",   thinkingLevel: "high",   maxTurns: 20 },
  code:       { provider: "anthropic", model: "claude-sonnet-4-6", thinkingLevel: "medium", maxTurns: 80 },
  verify:     { provider: "anthropic", model: "claude-opus-4-7",   thinkingLevel: "high",   maxTurns: 30 },
  pr:         { provider: "anthropic", model: "claude-sonnet-4-6", thinkingLevel: "off",    maxTurns: 5  },
};

export function mergePhaseModels(
  overrides: Partial<Record<Phase, Partial<PhaseModelConfig>>>,
  phase: Phase,
): PhaseModelConfig {
  return { ...DEFAULT_PHASE_MODELS[phase], ...(overrides[phase] ?? {}) };
}
```

Migration is straightforward additive SQL:

```sql
ALTER TABLE tasks ADD COLUMN phase_models JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Drizzle schema column: `phaseModels: jsonb('phase_models').notNull().default({})`. Map to/from `task.phaseModels` in the run-store. Empty `{}` is the canonical "use defaults" value.

**What to test:**
- Every `Phase` has an entry in `DEFAULT_PHASE_MODELS` (compile-time satisfied via `Record<Phase, ...>`; add a runtime round-trip test that iterates `PHASES`).
- `mergePhaseModels({}, "brainstorm")` returns the brainstorm default.
- `mergePhaseModels({ brainstorm: { thinkingLevel: "high" } }, "brainstorm")` returns the default with `thinkingLevel: "high"` and other fields preserved.
- `mergePhaseModels({ plan: {...} }, "brainstorm")` ignores the plan override.
- Round-trip a Task with non-empty `phaseModels` through `runs.createTask` / `runs.getTask` against a real Postgres test DB; assert equality.

**Commit:** `feat(shared,db): add per-phase model config column with defaults`

## Done When

- [ ] `pnpm db:migrate` applies cleanly on a fresh DB.
- [ ] `pnpm typecheck` passes for shared, db, orchestrator.
- [ ] New unit + integration tests pass.
- [ ] Existing tests (orchestrator + dashboard + db) still pass.

## E2E Verification

Not applicable — no user-visible behaviour changes in this phase.
