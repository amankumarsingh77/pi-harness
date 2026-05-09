# Brainstorm — real pi-coding-agent integration

**Status:** implemented
**Date:** 2026-05-09
**Supersedes (in part):** the "scripted mock" half of `2026-05-09-brainstorm-phase-design.md`. The dashboard contract, JSONL/EventStore dual-write, and approval gate are unchanged. What changes is the agent driver: the canned `BRAINSTORM_SCRIPT` in `apps/orchestrator/src/agents/brainstorm-script.ts` is replaced by a live `@earendil-works/pi-coding-agent` session.

## Goal

Replace the scripted brainstorm mock with a real pi agent session that:

- Runs in the task's git worktree.
- Asks structured, batched questions through a `submit_questions` tool whose JSON schema matches the dashboard's `BrainstormQuestion` shape.
- Authors `design.md` and `spec.md` itself via the built-in `write` tool.
- Calls `mark_ready` (with a server-side contract check) when both artifacts are complete.
- Survives orchestrator restarts via on-disk session resume.
- Reports real model usage and cost.

The dashboard does not change. SSE consumers see the same event types.

## Non-goals

- Replacing the plan / code / verify / pr drivers. Those still go through `runSubagent` (`pi --mode json`); only brainstorm is multi-turn.
- Sandboxing the worktree from the orchestrator. The agent is trusted; only `bash` is denied.
- A UI for browsing/editing pi session JSONL. We persist it for resume only.
- Backwards compatibility with the script. The mock is removed in the same change set.

## Architecture

### Generalization principle

The pi-bridge is a **thin generic wrapper** over `@earendil-works/pi-coding-agent`. It knows about sessions, models, tools, and event translation — nothing about phases. Phase-specific concerns (which custom tools each phase registers, how it interprets the agent's responses, what counts as "done") live in the orchestrator's per-phase agents (`apps/orchestrator/src/agents/<phase>.ts`). Adding a new phase that uses pi means writing a new agent file, not extending the bridge.

The brainstorm agent is the first consumer of the new bridge. Plan, code, and verify continue to use the existing mocked `PiSession` shape until each is migrated in its own slice. This avoids touching three working agents while we shake out the real SDK integration on one.

### Components

```
                                    ┌──────────────────────────────┐
                                    │ subagents/ours/brainstorm.md │
                                    └──────────────┬───────────────┘
                                                   │ system prompt
┌──────────────────┐  cwd, model     ┌─────────────▼─────────────┐
│ run-loop tick    │────────────────▶│ pi-bridge:                │
│ (brainstorm.ts)  │                 │  createBrainstormSession  │──▶ pi SDK
└────────┬─────────┘  PiBridgeEvent  └─────────────┬─────────────┘    (in-process)
         │                                         │
         ▼                                         ▼
┌──────────────────┐                ┌────────────────────────────┐
│ BrainstormEvent  │                │ ~/.harness/<taskId>/       │
│ Bus (unchanged)  │                │   pi-session.jsonl         │
└────────┬─────────┘                │   design.md  spec.md       │
         │                          │   brainstorm.jsonl         │
         ▼                          └────────────────────────────┘
   JSONL + SSE
```

### Where the moving parts live

- **`packages/pi-bridge/src/agent-session.ts`** (new) — generic `createAgentSession({ cwd, model, thinkingLevel, maxTurns, sessionPath, systemPrompt, customTools, onEvent })`. Wraps the SDK's `createAgentSession`. Knows nothing about phases. Translates pi events to a richer `PiBridgeEvent` union (existing variants plus `tool_call` with structured `input`, `tool_result` with structured `output`, `turn_end` with usage). Returns `{ prompt(text), close() }`. `prompt()` resolves when the SDK's `agent_end` fires; the bridge aggregates token usage from `agent_end` and exposes it via the `turn_end` event.
- **`apps/orchestrator/src/agents/brainstorm-tools.ts`** (new) — defines the two phase-specific custom tools `submit_questions` and `mark_ready`. Each is a TypeBox `ToolDefinition`. The handlers receive the `BrainstormEventBus` and `ArtifactsStore` via closure. `submit_questions` returns `terminate: true` to halt the agent for user input; `mark_ready` runs the contract check and returns `terminate: true` on success or a structured error on failure (which lets the agent retry within the same turn).
- **`packages/pi-bridge/src/system-prompt.ts`** (new) — builds the loader. Reads `subagents/ours/brainstorm.md`, returns a `DefaultResourceLoader` with `systemPromptOverride: () => "<pi default> + brainstorm role"`.
- **`packages/pi-bridge/src/auth.ts`** (new) — reads `.env.harness` from the project root once, exposes `getApiKey(provider)`. Errors loudly if a provider used in the task's per-phase config has no key.
- **`apps/orchestrator/src/agents/brainstorm.ts`** (rewritten) — `runBrainstorm({ taskId, cwd, store, bus, model, thinkingLevel, maxTurns })` becomes: open or resume the pi session, decide what prompt to feed it (initial vs follow-up vs revision), drain events, halt on `submit_questions` / `mark_ready`. The script walker is deleted.
- **`apps/orchestrator/src/agents/brainstorm-script.ts`** — deleted.
- **`apps/orchestrator/src/runner/run-loop.ts`** — gains the per-phase model config lookup; passes `{ model, thinkingLevel, maxTurns }` from the task row into `runBrainstorm`.

### Data layout per task

Inside the task's worktree (`<repoRoot>/.harness/worktrees/<taskId>/`):

```
.harness/<taskId>/
  design.md             # authored by the agent via `write` tool
  spec.md               # authored by the agent via `write` tool
  brainstorm.jsonl      # our event log (existing — unchanged contract)
  pi-session.jsonl      # pi's session state, used for resume
```

`pi-session.jsonl` lives next to our own log so it gets cleaned up with the worktree. Its path is recorded on the run row (`runs.pi_session_path`) so resume is unambiguous across orchestrator restarts.

## The protocol the agent follows

The brainstorm system prompt (`subagents/ours/brainstorm.md`, rewritten) tells the agent:

1. You are running in a git worktree at `<cwd>`. The user's task is in the prompt.
2. Your job is to produce two artifacts at `.harness/<taskId>/design.md` and `.harness/<taskId>/spec.md`. Frontmatter (status, last_updated_by, …) is already present — preserve it.
3. To ask the user questions, call `submit_questions` with a non-empty array. Always batch: ask everything you need at once. Halt your turn after the call; the harness will resume you with the user's answers.
4. To author or revise an artifact, use the built-in `write` tool. Read existing content first if you're revising. Do not write outside `.harness/<taskId>/`.
5. When both artifacts cover Goals, Trade-offs, Alternatives, Verification scenarios, and Acceptance criteria, and frontmatter status is still `draft`, call `mark_ready`. The harness will validate and either accept (status flips to `ready`) or return an error describing what's missing.
6. You may use `read` to look at repo files for evidence to cite in answers. You do not have `bash`, `edit`, `grep`, `find`, or `ls`.

### `submit_questions` tool

Input schema (mirrors `BrainstormEventInput["brainstorm_question"]` minus envelope):

```ts
{
  questions: Array<{
    questionId: string;          // stable id, agent's choice, must be unique within run
    prompt: string;
    options: Array<{
      id: string;
      label: string;
      recommended: boolean;
      evidence: string[];        // file:line citations the agent used
    }>;
    sectionTarget: { artifact: "design" | "spec"; section: string };
    multiSelect?: boolean;
  }>;
}
```

Handler behaviour:

- Validate the input against the schema. On failure, return `{ error: "<message>" }` to the agent so it can correct.
- For each question, call `bus.publish({ kind: "brainstorm_question", ... })`. The bus's existing dual-write (JSONL + EventStore) handles dashboard delivery.
- Return `{ status: "submitted", awaiting: ["<id1>", "<id2>"] }` to the agent.
- The agent's turn ends naturally after this tool call (the system prompt instructs it to stop).
- The harness ends the tick with `ready: false`. The user answers via the existing transitions endpoint, which appends `brainstorm_answer` to JSONL.

### `mark_ready` tool

Input schema: `{}` (no arguments).

Handler behaviour — **contract check, not pure signal**:

1. Read `design.md` and `spec.md` from `.harness/<taskId>/`. Missing file → return `{ error: "design.md not found" }`.
2. Parse YAML frontmatter. Missing or malformed → `{ error: "<file>: frontmatter invalid" }`.
3. Required sections (heading present + non-whitespace body underneath):
   - `design.md` — `## Goals`, `## Trade-offs`, `## Alternatives considered`
   - `spec.md` — `## Verification scenarios`, `## Acceptance criteria`
4. Any missing → return `{ error: "spec.md missing required section: ## Acceptance criteria" }` (one error at a time; the agent gets to fix and try again).
5. All present → flip both files' frontmatter `status` from `draft` to `ready`, set `last_updated_by: "brainstorm-agent"`, write back. Publish `brainstorm_system { systemKind: "status_changed", data: { status: "ready" } }`. Return `{ status: "ready" }`.

The handler is the harness's enforcement point. The agent cannot mark ready by claiming to be done; it has to actually have written the sections.

## Resume strategy

Disk-resume, every tick. No in-memory session cache.

```
runBrainstorm tick:
  1. Load run row → { piSessionPath, model, thinkingLevel, maxTurns }
  2. Read brainstorm.jsonl → answers, revisionRequested?, ready?
  3. If ready in jsonl: return { ready: true }
  4. Decide the prompt to feed this tick:
     a. First-ever tick (no piSessionPath): "Begin brainstorming this task: <task.description>. Worktree: <cwd>. Artifacts: .harness/<taskId>/{design,spec}.md."
     b. New answers since last tick: "User answered: <id>=<choice>; <id>=<choice>. Continue."
     c. Revision requested since last tick: "User requested revisions: <comment>. Re-examine the artifacts and ask any clarifying questions."
     d. None of the above (re-entry without progress): no-op, return current state.
  5. Open session: SessionManager.open(piSessionPath) if path exists, else SessionManager.file(<worktree>/.harness/<taskId>/pi-session.jsonl) and persist that path on the run row.
  6. session.prompt(<chosen prompt>) — drains until agent_end.
  7. During the prompt, our event handler intercepts:
       tool_execution_start("submit_questions") → publish brainstorm_question events, set haltReason="questions"
       tool_execution_start("mark_ready") that succeeds → set haltReason="ready"
       tool_execution_end on built-in write → republish through ArtifactsStore
       agent_end → record usage on the run's cost ledger
  8. Return { ok, ready: haltReason === "ready", costUsd, inputTokens, outputTokens }.
```

The same-session contract for revisions falls out of this naturally: revisions append a new `brainstorm_revision_requested` event to JSONL, which decision step 4(c) picks up next tick and turns into a `session.prompt` on the resumed session.

`maxTurns`: enforced by counting `turn_start` events within a single `runBrainstorm` invocation. If exceeded, abort the session, mark the task `failed` with reason `"brainstorm: maxTurns exceeded"`. The user can request changes (which starts a new prompt on the resumed session, resetting the per-tick counter) but the session keeps its history.

## Per-phase model configuration

### Defaults (in code)

```ts
// packages/shared/src/config/phase-models.ts
export const DEFAULT_PHASE_MODELS = {
  brainstorm: { provider: "anthropic", model: "claude-sonnet-4-6", thinkingLevel: "medium", maxTurns: 30 },
  plan:       { provider: "anthropic", model: "claude-opus-4-7",   thinkingLevel: "high",   maxTurns: 20 },
  code:       { provider: "anthropic", model: "claude-sonnet-4-6", thinkingLevel: "medium", maxTurns: 80 },
  verify:     { provider: "anthropic", model: "claude-opus-4-7",   thinkingLevel: "high",   maxTurns: 30 },
  pr:         { provider: "anthropic", model: "claude-sonnet-4-6", thinkingLevel: "off",    maxTurns: 5  },
} as const satisfies Record<Phase, PhaseModelConfig>;

export type PhaseModelConfig = {
  provider: string;
  model: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  maxTurns: number;
};
```

### Schema

`tasks` table gains one column:

```sql
ALTER TABLE tasks ADD COLUMN phase_models JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Stored as `Record<Phase, PhaseModelConfig>`. Empty object means "use defaults"; per-phase keys override individual phases. Frozen at first phase entry — once any row exists in `runs` for the task, the orchestrator's task-update endpoint rejects writes to `phase_models` with HTTP 409. The Intake form is the only writer before that point.

### Intake UX

The Intake form (`/tasks/new`) gains a collapsible "Model configuration" block, default-collapsed, default-empty (= use defaults). Expanding shows five rows (one per phase) with three controls each: provider select, model select (filtered by provider), thinking level select. `maxTurns` is a number input. Tooltip per row shows the default. The form's server action validates that every chosen `(provider, model)` is in the model registry and that an API key exists in `.env.harness` for the provider.

The dashboard component lives at `apps/dashboard/components/intake/phase-models.tsx`. Per project rule 5, the frontend-design skill runs before that component is built.

### Read path

`runBrainstorm` and the other phase drivers do `effectiveConfig = { ...DEFAULT_PHASE_MODELS[phase], ...task.phaseModels[phase] }` at tick start.

## Auth

`.env.harness` at repo root, gitignored, format:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
# (one per provider in use)
```

`packages/pi-bridge/src/auth.ts` reads it once at orchestrator boot, holds keys in memory. `createBrainstormSession` calls `authStorage.setRuntimeApiKey(provider, key)` per session — no `~/.pi/agent/auth.json` mutation, no global state leak.

Missing key for a configured provider → orchestrator refuses to advance the task into the phase, surfaces a `phase_blocked` event with reason `"missing API key for <provider>"`. The dashboard already renders `phase_blocked` (existing event kind).

## Event translation

New `PiBridgeEvent` variants:

```ts
type PiBridgeEvent =
  | { kind: "message_delta"; text: string }       // existing
  | { kind: "tool_call"; tool: string; input: unknown }
  | { kind: "tool_result"; tool: string; ok: boolean; output?: unknown }
  | { kind: "log"; level: "info" | "warn" | "error"; text: string }
  | { kind: "question_submitted"; questions: BrainstormQuestion[] }   // new
  | { kind: "mark_ready_called"; ok: boolean; error?: string }        // new
  | { kind: "artifact_written"; artifact: "design" | "spec" }         // new
  | { kind: "turn_end"; usage: { inputTokens: number; outputTokens: number; costUsd: number } };  // new
```

`pi-bridge` is the only place that knows about pi's native event shapes. Above this layer, the orchestrator only sees `PiBridgeEvent`s.

## Failure modes

| Failure | Behaviour |
|---|---|
| Agent calls `submit_questions` with malformed input | Tool returns `{ error: "..." }`; agent retries within same turn. If three retries fail, harness aborts the tick and marks the task `failed`. |
| Agent calls `mark_ready` but contract check fails | Tool returns `{ error: "<missing thing>" }`; agent fixes and retries. No retry cap (the agent can keep trying as long as it's within `maxTurns`). |
| Agent writes to a path outside `.harness/<taskId>/` | The `write` tool succeeds (we don't sandbox), but our `tool_execution_end` observer ignores it — no `artifact_written` event, no `ArtifactsStore` republish. The agent's prompt explicitly forbids this; if it happens repeatedly we tighten via tool factory wrap. |
| `maxTurns` exceeded | Session aborted, task marked `failed`, reason recorded. User-requested revision can revive (new prompt resets per-tick counter). |
| Provider API error (rate limit, 5xx) | pi's built-in `auto_retry` handles transient errors. Hard failure → `agent_end` with error → harness emits `phase_blocked` with the provider error message. User can request changes (which retries) or abandon. |
| Orchestrator crashes mid-turn | Session JSONL is durable; next tick resumes at the last committed message. Any half-emitted `brainstorm_question` events are deduped by `hasQuestionEvent` (existing logic). |
| `pi-session.jsonl` corrupted | `SessionManager.open` throws → harness logs, deletes the file, starts a fresh session, replays all answers from `brainstorm.jsonl` as a single resume prompt. |

## Testing

Two layers, both real:

1. **`packages/pi-bridge` unit tests** — inject a fake `PiSdkAdapter` whose `createAgentSession` returns a hand-driven event stream. Verify event translation, tool registration, write observation. No real LLM calls.
2. **`apps/orchestrator` integration test** — uses the same fake adapter, drives a full brainstorm cycle: initial prompt → `submit_questions` → user answers via transitions endpoint → next tick resumes session → `write` events → `mark_ready` → contract check → status flips. Asserts on JSONL contents, EventStore events, and artifact frontmatter.

A live smoke test against a real Anthropic key is gated behind `PI_LIVE=1` and excluded from CI. Run manually before merging.

## Migration

This change is destructive to the brainstorm mock, not to data. Steps:

1. Land `pi-bridge` additions (auth, system-prompt loader, brainstorm-session). Existing `pi-bridge` exports stay.
2. Land `tasks.phase_models` migration (additive, default `{}`).
3. Land Intake "Model configuration" block (frontend-design skill first; see project rule 5).
4. Rewrite `apps/orchestrator/src/agents/brainstorm.ts` to use the new session. Delete `brainstorm-script.ts` and its tests.
5. Update integration tests to use the fake adapter.
6. Tag a smoke test with `PI_LIVE=1` and run it manually against a real key before merging.

Existing in-flight tasks (those with `brainstorm.jsonl` already populated by the script) are not migrated — the script and the agent agree on the JSONL contract, so a resumed task's events replay through the prompt-building step 4(b) above and the agent picks up from there.

## Open questions

None blocking. Two parking-lot items:

- Whether to surface pi's `thinking_delta` stream as a debug pane in the dashboard. Current decision: no, drop it. Reconsider after we see real runs.
- Whether `read` should be path-allowlisted later. Current decision: no constraint. Reconsider if we observe the agent fishing.
