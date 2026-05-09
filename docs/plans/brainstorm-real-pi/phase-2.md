# Phase 2: Generic pi-bridge `agent-session`

> **Status:** pending

## Overview

After this phase the harness has a phase-agnostic, event-driven session driver over `@earendil-works/pi-coding-agent`. Any phase can use it: pass `cwd`, `model`, `thinkingLevel`, `maxTurns`, `systemPrompt`, optional `customTools`, optional `sessionPath`, and an `onEvent` callback. The bridge owns event translation and usage aggregation. No phase consumes it yet (Phase 3+ does); the existing legacy `PiSession` is left in place so plan/code keep working.

This phase is independent of Phase 1.

## Implementation

**Files:**
- Create: `packages/pi-bridge/src/agent-session.ts` — the new generic driver.
- Create: `packages/pi-bridge/src/auth.ts` — reads `.env.harness` once, provides `getApiKey(provider)`.
- Modify: `packages/pi-bridge/src/types.ts` — extend `PiBridgeEvent` union with `turn_end`, `tool_call` (structured `input`), `tool_result` (structured `output`), `error`. Keep existing variants.
- Modify: `packages/pi-bridge/src/index.ts` — export `createAgentSession`, `AgentSessionOptions`, `AgentSession`, `AuthError`.
- Create: `packages/pi-bridge/src/_test/fake-sdk.ts` — `FakeAgentSdkAdapter` that emits a hand-driven event sequence.
- Test: `packages/pi-bridge/src/agent-session.test.ts` — adapter-injected, no network.

**Pattern to follow:** `packages/pi-bridge/src/session.ts:6` — adapter injection via `_mock.ts`. The new file uses the same dependency-injection seam (`adapter?: PiSdkAdapter` parameter) so tests stay deterministic.

**What to build:**

The public API:

```ts
export type AgentSessionOptions = {
  cwd: string;
  model: { provider: string; model: string };
  thinkingLevel?: ThinkingLevel;
  maxTurns?: number;
  systemPrompt?: string;             // appended to pi defaults via DefaultResourceLoader
  customTools?: ToolDefinition[];    // TypeBox-defined tools
  sessionPath?: string;              // explicit path; defaults to pi's default location
  onEvent: (e: PiBridgeEvent) => void;
};

export type AgentSession = {
  prompt(text: string): Promise<{ inputTokens: number; outputTokens: number; costUsd: number }>;
  close(): Promise<void>;
};

export async function createAgentSession(
  opts: AgentSessionOptions,
  adapter?: AgentSdkAdapter,        // injectable for tests
): Promise<AgentSession>;
```

Internal mechanics:

1. **Auth.** `getApiKey(opts.model.provider)` reads `.env.harness` from the project root (cached). Missing → throw `AuthError("missing API key for <provider>")`. Caller (orchestrator) maps this to a `phase_blocked` event.
2. **Tools.** Start from `createCodingTools(opts.cwd)` (the SDK factory — required when overriding cwd). Concat `opts.customTools ?? []`. Caller can filter built-ins before passing if it wants to drop `bash` etc. — the bridge doesn't decide policy.
3. **System prompt.** Build a `DefaultResourceLoader` whose `systemPromptOverride` returns `pi-default + "\n\n---\n\n" + opts.systemPrompt` when `opts.systemPrompt` is set. (Read pi's default once via `loader.getDefaultSystemPrompt()` if exposed; otherwise just prepend our text — confirm in the SDK types when implementing.)
4. **Session manager.** `opts.sessionPath ? SessionManager.open(opts.sessionPath) : SessionManager.inMemory()`. The orchestrator owns path policy.
5. **Subscribe and translate.** Single `session.subscribe(event => ...)` callback. Translation table:

   | SDK event | PiBridgeEvent emitted |
   |---|---|
   | `message_update` w/ `text_delta` | `{ kind: "message_delta", text }` |
   | `message_update` w/ `thinking_delta` | dropped (parking-lot) |
   | `tool_execution_start` | `{ kind: "tool_call", tool, input }` |
   | `tool_execution_end` (success) | `{ kind: "tool_result", tool, ok: true, output }` |
   | `tool_execution_end` (error) | `{ kind: "tool_result", tool, ok: false, output: errorPayload }` |
   | `turn_start` | (counted internally for `maxTurns`; not emitted) |
   | `agent_end` | `{ kind: "turn_end", usage: { inputTokens, outputTokens, costUsd } }` and resolves the in-flight `prompt()` promise |
   | `auto_retry_start` | `{ kind: "log", level: "warn", text: "auto_retry attempt N: <err>" }` |

6. **`prompt()` aggregation.** Each call captures its own `agent_end` payload (the bridge tracks the in-flight prompt via a single-flight gate — only one `prompt()` may be in flight at a time; assert if a second call arrives before the first resolves) and resolves with usage for *that prompt only*.
7. **`maxTurns`.** Increment on each `turn_start` since prompt-start. On exceed: call `session.abort()` (or equivalent — confirm in types), emit `{ kind: "error", text: "maxTurns exceeded" }`, reject the in-flight `prompt()`.

**What to test:**
- Happy path: `prompt("hi")` → fake adapter emits `text_delta`, `agent_end` → resolves with usage; `onEvent` saw `message_delta` and `turn_end`.
- Tool round-trip: fake adapter emits `tool_execution_start("foo", { x: 1 })` then `tool_execution_end("foo", { y: 2 })` then `agent_end`; bridge emits `tool_call` and `tool_result` with structured payloads.
- `terminate: true` from a custom tool ends the turn before `agent_end`; bridge still resolves on `agent_end` (the SDK fires it after the terminating tool batch).
- `maxTurns` enforced: fake adapter emits 3 `turn_start`s; bridge with `maxTurns: 2` rejects with "maxTurns exceeded".
- Auth missing: `createAgentSession` with a provider not in `.env.harness` throws `AuthError`.
- Single-flight: second `prompt()` while first is in flight throws an immediate error.
- Resume: passing `sessionPath` constructs the SDK with `SessionManager.open(path)` (verified via adapter spy).

**What NOT to test in this phase:** real SDK integration (covered by Phase 6 live smoke). Phase 2 is pure adapter + event translation.

**Commit:** `feat(pi-bridge): generic agent-session driver with event translation`

## Done When

- [ ] `pnpm --filter @pi-harness/pi-bridge test` passes.
- [ ] `pnpm typecheck` passes across the workspace.
- [ ] Existing `PiSession` (legacy) and `runSubagent` (one-shot) still exported and untouched.
- [ ] No new code path uses `process.cwd()` — all paths flow through `opts.cwd`.

## E2E Verification

Not applicable — internal library, no user-visible behaviour. Real-SDK integration is Phase 6.
