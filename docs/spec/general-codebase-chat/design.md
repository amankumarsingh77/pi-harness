# Design — General Codebase Chat

**Status:** Approved (2026-05-30)
**Spec name:** `general-codebase-chat`
**Author:** orchestrate pipeline (brainstorm stage)

## Approved Visual Reference (mocks)

The UI for this feature is fully designed and approved as static HTML mocks. **All
implementation must match these mocks** — layout, spacing, the Linear-style
monochrome theme, and every interaction state:

- **Primary mock (build target):** [`docs/mocks/general-chat-v2-2026-05-30.html`](../../mocks/general-chat-v2-2026-05-30.html)
  Covers: chat-history rail, collapsible thinking block, tool-call cards
  (args/timing/result/running), real-time streaming with cursor, stop-mid-stream
  (send → red stop square), provider/model picker (grouped, searchable, with
  context/cost/reasoning metadata), thinking-level picker, and the responsive
  (mobile) layout.
- **Earlier iteration (reference only):** [`docs/mocks/general-chat-page-2026-05-30.html`](../../mocks/general-chat-page-2026-05-30.html)

Verified in-browser across all five scenarios (Empty, Streaming, Tool-heavy,
Stopped, Error) plus mobile, plus model/thinking pickers. Screenshots are the
acceptance bar for the corresponding `type: "ui"` verification claims.

## Problem & Purpose

The pi-harness dashboard is task/phase-centric: every agent interaction is bound
to a task's lifecycle (brainstorm → plan → code → verify). There is no way to
simply **ask the agent about the codebase** — trace a flow, explain an error,
locate where something lives — without creating a task. This feature adds a
general, repo-scoped chat surface, ChatGPT/Claude-style, that:

1. Keeps a **chat history** of prior threads (sidebar rail).
2. Streams the agent's response **in real time** over SSE.
3. Renders the agent's **thinking** in a collapsible block.
4. Renders **tool calls** (name, args, result, timing, running state).
5. Lets the user **terminate** a streaming response mid-flight.
6. Lets the user **choose/update the provider, model, and thinking level**.

Chat is **read-only by default** — it inspects the repo and explains; it does not
write files. (Editable / task-handoff mode is explicitly out of scope here.)

## Architecture

Chat reuses the existing harness seams rather than inventing new ones. Four hops,
each with one job — mirroring the live-event architecture already in place.

```
┌─────────────┐   prompt    ┌──────────────────┐  PiBridgeEvent  ┌────────────────┐
│  Dashboard  │ ──────────▶ │   Orchestrator   │ ──────────────▶ │   pi-bridge    │
│  (Next 15)  │   POST      │   (Fastify)      │   onEvent()     │ createAgent-   │
│             │ ◀────────── │  /api/chat/*     │ ◀────────────── │   Session()    │
└─────────────┘  SSE stream └──────────────────┘     prompt()    └────────────────┘
       │  EventSource                │  in-memory ChatSessionStore       │  pi AI SDK
       │  (chat events)              │  + JSONL persistence              │
       ▼                             ▼                                   ▼
  React reducer               threads + messages                  model registry
  (thinking / tools /         (.harness or state dir)             (.env.harness creds)
   message deltas)
```

### Components & responsibilities

**pi-bridge (existing, reused as-is):** `createAgentSession()` already exposes the
exact event surface a chat needs — `message_delta`, `tool_call`, `tool_result`,
`log`, `turn_end`, `error` — plus `prompt(text)` and `abort()`. No bridge changes
are anticipated; if a gap appears it is additive.

**Orchestrator — chat domain (new, modeled on the brainstorm/live precedent):**
- `ChatSessionStore` — owns chat threads + messages. In-memory map for live
  streaming state, JSONL persistence for history (same pattern as the existing
  event/live stores). One pi `AgentSession` per active stream, keyed by thread.
- `POST /api/chat/threads` — create a thread; `GET /api/chat/threads` — list;
  `GET /api/chat/threads/:id` — fetch a thread with its messages.
- `POST /api/chat/threads/:id/messages` — submit a user message; starts an agent
  turn. Returns immediately; tokens arrive over the stream.
- `GET /api/chat/threads/:id/stream` — SSE stream of chat events for a thread
  (frames: `chat.delta`, `chat.thinking`, `chat.tool_call`, `chat.tool_result`,
  `chat.turn_end`, `chat.error`), with `id:` sequence + heartbeat + `last-event-id`
  resume, identical to `routes/live.ts`.
- `POST /api/chat/threads/:id/stop` — calls `session.abort()`; emits a terminal
  `chat.stopped` frame; partial assistant text is preserved.
- Model/thinking selection is per-thread state, passed into `createAgentSession`'s
  `{ model: { provider, model }, thinkingLevel }` options.

**Dashboard — chat surface (new, matches the mock):**
- Route `/chat` (and `/chat/[threadId]`) under `apps/dashboard/app`.
- `chat-rail` (history), `chat-transcript`, `chat-message` (with collapsible
  `chat-thinking` + `chat-tool-call` children), `chat-composer`, and the
  `model-picker` / `thinking-picker` dropdowns.
- A `useChatStream` hook wrapping `EventSource`, reducing chat frames into thread
  state (reusing the hydration/merge idioms from `lib/live-event-client.ts`).
- A `chat-live-provider` mirroring the existing `dashboard-live-provider`.
- A "Chat" entry added to `topbar-nav`.

### Shared types (new, in `packages/shared`)

`ChatThread`, `ChatMessage`, `ChatMessagePart` (text | thinking | tool_call |
tool_result), `ChatStreamFrame` discriminated union, `ChatModelSelection`. These
are the contract between orchestrator and dashboard, validated at the SSE boundary
exactly like `LiveEventEnvelope`.

## Data Flow (streaming a turn)

1. User types in `chat-composer`, picks model/thinking (or uses thread defaults),
   hits send. Dashboard `POST`s the message and opens (or already holds) the
   thread's `EventSource`.
2. Orchestrator appends the user message, creates/loads the pi `AgentSession` with
   the selected `{provider, model, thinkingLevel}`, calls `session.prompt(text)`.
3. `onEvent` translates each `PiBridgeEvent` into a `ChatStreamFrame`, assigns a
   monotonic sequence, persists it, and fans it out to the thread's SSE subscribers.
4. Dashboard's `useChatStream` reduces frames: `chat.thinking` → thinking block,
   `chat.tool_call`/`chat.tool_result` → tool cards, `chat.delta` → appended
   assistant text (with streaming cursor), `chat.turn_end` → finalize + usage.
5. **Stop:** user clicks the stop control → `POST /stop` → `session.abort()` →
   `chat.stopped` frame → UI freezes the partial response and shows the
   "Stopped by you" notice with a Continue affordance.
6. **Error/reconnect:** transient orchestrator unreachability surfaces as the
   error notice; the client resumes from `last-event-id` (the sequence cursor),
   matching the live-stream proxy behavior.

## Error Handling

- **Orchestrator unreachable (503):** proxy returns 503 (existing pattern in
  `app/api/live/stream/route.ts`); client shows reconnect notice + resumes by
  sequence.
- **Provider auth missing/invalid:** `createAgentSession` throws `AuthError`;
  surfaced as a `chat.error` frame naming the provider + that creds live in
  `.env.harness`. Picker marks unauthenticated providers (OAuth) as "sign in".
- **Abort mid-stream:** partial text retained; no orphaned session (abort then
  dispose).
- **Reconnect dedupe:** frames keyed by sequence/id; the reducer merges by id so a
  resumed stream never double-renders (same guarantee as `mergeLiveEnvelopes`).

## Testing Strategy

- **Unit (vitest):** `ChatSessionStore` (append/list/abort/sequence), frame
  translation from `PiBridgeEvent`, reducer logic in `useChatStream`.
- **Component (Testing Library + happy-dom):** thinking collapse/expand, tool-call
  rendering states (running/ok/error), streaming cursor, stop→stopped transition,
  model & thinking pickers (open, select, label propagation, search filter),
  empty/error states.
- **E2E (Playwright):** full streaming turn against a faked/stubbed session,
  stop-mid-stream, model switch — driving the real `/chat` route. UI claims proven
  via Playwright MCP screenshots matched against the approved mock.

## Out of Scope (YAGNI)

- Editable / write-enabled chat or task handoff from a thread.
- Multi-user / auth (dashboard is single-operator).
- Cross-thread search ranking beyond simple title filter.
- Attachments / image input.

## External Dependencies & Fallback Chain

This feature introduces **no new third-party libraries**. It composes only
already-present, already-trusted dependencies. The library-probe gate should treat
the in-repo packages as the "libraries" to smoke-test for availability.

| Dependency | Role | Already in repo? | Fallback chain |
|---|---|---|---|
| `@pi-harness/pi-bridge` (`createAgentSession`) | Agent session + event stream + abort | Yes (`packages/pi-bridge`) | No external fallback — this is the integration seam. If the live pi AI SDK provider is unreachable, chat degrades to an error frame (same as brainstorm). |
| pi AI SDK provider (CrofAI via `.env.harness` `CROFAI_API_KEY`) | LLM inference backend | Yes (`providers/crofai.ts`) | 1) CrofAI → 2) Anthropic (if `ANTHROPIC_API_KEY` present) → 3) surface auth error in picker. The picker itself is the user-facing fallback selector. |
| Fastify SSE (`reply.raw`) | Server-sent event transport | Yes (`routes/live.ts`) | No fallback — native to the existing orchestrator HTTP stack. |
| Browser `EventSource` | Client SSE consumer | Yes (`lib/live-event-client.ts`) | No fallback — standard web API, already used by live provider. |
| `@tanstack/react-query` | Thread list/fetch caching | Yes (dashboard dep) | No fallback — already the data layer. |
| `react-markdown` + `remark-gfm` | Render assistant markdown | Yes (dashboard dep) | No fallback — already used for artifacts. |

**Probe target:** the live CrofAI provider via `.env.harness` — confirm a minimal
`createAgentSession` + `prompt` round-trip streams `message_delta` and `turn_end`
events. This is the one live-service dependency whose health gates the feature.
