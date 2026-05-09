# Phase 2: Artifact Model (Frontmatter + JSONL Writer)

> **Status:** pending

## Overview

After this phase, the harness has a single canonical model for branch-scoped artifacts: typed `Artifact` objects in `@pi-harness/shared` with full frontmatter shape, a parse/stringify helper, an `ArtifactsStore` that reads/writes `<worktree>/.harness/T-NNN/{design.md, spec.md}`, a `JsonlWriter` for `brainstorm.jsonl`, and a `brainstormEventBus` fan-out that mirrors every event to both EventStore (live SSE) and the JSONL file (durable branch history).

Phase 1's hand-rolled scaffold writer is replaced by the proper helper.

## Step Graph

```dot
digraph steps {
  rankdir=LR
  node [shape=box]

  step_1 [label="Step 1: Frontmatter helper + types"]
  step_2 [label="Step 2: ArtifactsStore rewrite"]
  step_3 [label="Step 3: JsonlWriter + event bus fan-out"]

  step_1 -> step_2
  step_1 -> step_3
}
```

### Step 1: Frontmatter helper + types
- Files: `packages/shared/src/types/artifact.ts`, `packages/shared/src/frontmatter.ts`
- Tests: parse round-trips, stringify is stable, status enum is enforced, missing required fields throw.
- Done: `Artifact` type + Zod schema exported from `@pi-harness/shared`; `parseFrontmatter` / `stringifyArtifact` helpers tested.

### Step 2: ArtifactsStore rewrite
- Files: `apps/orchestrator/src/agents/artifacts-store.ts`
- Tests: read/write round-trip, missing artifact returns `null` (not throw), write is atomic (temp file + rename), legacy `brainstorm.json`/`brainstorm.md` paths removed.
- Done: store reads/writes at `<worktree>/.harness/<taskId>/{design.md, spec.md}`, all callers updated.

### Step 3: JsonlWriter + event bus fan-out
- Files: `apps/orchestrator/src/adapters/jsonl-writer.ts`, `apps/orchestrator/src/agents/brainstorm-event-bus.ts`
- Tests: append is line-safe under concurrent writes, fsync per write, fan-out delivers to both EventStore and JSONL exactly once.
- Done: a single `publish(event)` call writes to JSONL and EventStore.

## Implementation

**Files:**
- Create: `packages/shared/src/types/artifact.ts` — `Artifact`, `ArtifactKind = 'design' | 'spec'`, `ArtifactStatus = 'draft' | 'ready' | 'approved'`, `Frontmatter` shape, all with Zod schemas. Re-export from `packages/shared/src/index.ts`.
- Create: `packages/shared/src/frontmatter.ts` — `parseFrontmatter(raw: string): { fm: Frontmatter; body: string }` and `stringifyArtifact(a: Artifact): string`. Use `gray-matter` if already a dep; otherwise hand-roll (the format is small and bounded — see code below).
- Modify: `apps/orchestrator/src/agents/artifacts-store.ts` — full rewrite. New API:
  - `readArtifact(cwd, taskId, kind): Promise<Artifact | null>`
  - `writeArtifact(cwd, taskId, artifact): Promise<void>` (atomic via temp file + rename)
  - `listArtifacts(cwd, taskId): Promise<Artifact[]>`
  - Drop `writeBrainstorm`, `readBrainstorm`, `brainstorm.json`/`brainstorm.md` callers.
- Create: `apps/orchestrator/src/adapters/jsonl-writer.ts` — class `JsonlWriter` with `constructor(path: string)` and `async append(event: object): Promise<void>`. Open with `O_APPEND`, fsync per write, serialize JSON with no trailing newline issues. Mutex for concurrent appends within a process.
- Create: `apps/orchestrator/src/agents/brainstorm-event-bus.ts` — `BrainstormEventBus { constructor({ eventStore, jsonlWriter, runId, taskId }); publish(event): Promise<void> }`. Single emit point; writes to JSONL first (durable), then EventStore (broadcast). On JSONL failure, do NOT publish to EventStore.
- Modify: `apps/orchestrator/src/runner/scaffold-brainstorm.ts` — replace inline frontmatter writer with the new helper.
- Modify: `apps/orchestrator/src/domain/events.ts` — extend `AgentEvent` union with brainstorm-specific kinds: `brainstorm_question`, `brainstorm_answer`, `brainstorm_system`, `brainstorm_revision_requested`. Each carries the structured payload from the design doc's JSONL format section.
- Test: `packages/shared/src/frontmatter.test.ts` — parse/stringify round-trip, malformed input, status enum enforcement.
- Test: `apps/orchestrator/src/agents/artifacts-store.test.ts` — read missing → null, write+read round-trip, atomic write semantics.
- Test: `apps/orchestrator/src/adapters/jsonl-writer.test.ts` — concurrent appends produce N lines, no interleaving.
- Test: `apps/orchestrator/src/agents/brainstorm-event-bus.test.ts` — fan-out delivers exactly once to each sink, JSONL failure prevents EventStore publish.

**Pattern to follow:**
- Use `gray-matter` if already in `package.json`. If not, hand-roll: frontmatter is `^---\\n([\\s\\S]+?)\\n---\\n` followed by body. Use `js-yaml` (likely already a dep) for the YAML inside.
- For atomic write: `await fs.writeFile(tmpPath, content); await fs.rename(tmpPath, finalPath);` — same partition guarantees atomicity on POSIX.
- Reference context7 for the current `gray-matter` API before relying on it; verify `js-yaml` version.

**What to test:**
- Frontmatter round-trip: `stringify(parse(x)).fm` deep-equals `x.fm` for valid inputs.
- Status field rejects values outside the enum (Zod schema enforces).
- ArtifactsStore writes are atomic — kill mid-write leaves the old file intact (test by writing a corrupted temp file and verifying read still returns prior).
- JsonlWriter under concurrent `append()` calls produces exactly N lines, no truncation, no interleaving (use `Promise.all` of 100 appends).
- BrainstormEventBus: spying on EventStore.append + JsonlWriter.append shows each gets called exactly once per `publish()`.
- BrainstormEventBus: when JsonlWriter throws, EventStore is NOT called (durability before broadcast).

**Traces to:** Decisions #1, #2, #6 from design doc.

**What to build:**

Frontmatter shape (in `packages/shared/src/types/artifact.ts`):
```ts
export const Frontmatter = z.object({
  task: z.string(),                          // "T-NNN"
  kind: z.enum(["design", "spec"]),
  parent: z.string().nullable(),             // path to parent artifact, or null
  status: z.enum(["draft", "ready", "approved"]),
  commit: z.string().optional(),             // sha at write time, optional pre-commit
  branch: z.string(),                        // "pi/T-NNN"
  last_updated: z.string(),                  // ISO 8601
  last_updated_by: z.string(),               // "orchestrator" | "brainstorm-agent" | "user"
});
export type Frontmatter = z.infer<typeof Frontmatter>;

export type Artifact = {
  fm: Frontmatter;
  body: string;
};
```

Drop legacy paths intentionally — there's no migration concern (this is pre-prod). The existing `apps/orchestrator/src/agents/artifacts-store.test.ts` will need full rewrite, not adaptation.

**Commit:** `feat(orchestrator): branch-scoped artifact model with frontmatter + jsonl event bus`

## Done When

- [ ] All new tests pass; existing orchestrator tests pass.
- [ ] `pnpm typecheck` clean across workspace.
- [ ] Phase 1's `scaffold-brainstorm.ts` uses the helper (TODO removed).
- [ ] `gray-matter` (or chosen lib) usage verified against context7 docs before commit.
- [ ] Old `brainstorm.json`/`brainstorm.md` paths and helpers fully removed (no dead code).
