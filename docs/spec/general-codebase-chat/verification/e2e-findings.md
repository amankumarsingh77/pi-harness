# End-to-End Findings — general-codebase-chat

Live run: orchestrator (port 4000) + dashboard (port 3000) against live CrofAI,
driven through the real `/chat` UI with Playwright MCP on 2026-05-31.

## ✅ What works end-to-end (verified live)

- **Backend round-trip (API):** `POST /api/chat/threads` → `POST /messages` →
  `GET /stream` produced real `chat.delta` + `chat.turn_end` frames; assistant
  message finalized `complete` with text "PIPE_E2E_OK" and real usage
  ($0.0011) on `deepseek-v3.2`. Frames persisted to `frames.jsonl` with
  monotonic sequence + id (replayable). (REQ-010/011/013/014, REQ-050)
- **`/chat` page renders** with the real thread list from the orchestrator,
  grouped, matching the mock empty state. (REQ-001/002/003) — screenshot:
  `screenshots/live-empty.png`
- **New chat** creates a thread via API and routes to `/chat/[threadId]`.
- **Thread view** renders composer with the real model picker
  (`crofai/kimi-k2.6`), thinking picker, and read-only hint — sourced from the
  thread's model selection. (REQ-040) — `screenshots/live-thread-new.png`
- **Tool calls render** as cards with the green "done" status, against real repo
  paths, plus the usage footer. (REQ-021/023) — `screenshots/live-turn-full.png`
- **Streaming cursor** (`.cursor`) present in the DOM during an active turn.
  (REQ-012)
- **Hydration mismatch fixed**: `chat-rail` deferred clock-derived text to
  post-mount (was rendering `new Date()` during SSR). Console now clean apart
  from the harmless favicon 404.

## ✗ Defects found by the live run (must fix)

### BUG-1 (backend, high): multi-turn loses conversation context → empty follow-ups
`runChatTurn` creates a **fresh `createAgentSession` every turn with no
`sessionPath` and no prior-message history**, prompting only with the latest
`promptText`. Turn 1 works; turns 2 and 3 on the same thread finalized
`complete` with **empty text and zero tools** — the model gets a contextless
follow-up and returns nothing.
- Evidence: thread `7bb1239d…` server state shows messages #3 and #5 (assistant)
  with empty parts.
- Fix direction: give each thread a stable `sessionPath` (e.g.
  `<stateDir>/store/chat/<threadId>/session.json`) so the pi SDK persists and
  replays conversation state across turns — mirroring how brainstorm passes
  `sessionPath`. Pass it from the route into `runChatTurn`.

### BUG-2 (frontend, high): transcript shows only the current streamed message
`chat-view` computes `messages = mergeChatMessages(initialMessages,
stream.message)`. `initialMessages` is the page-load snapshot (never refetched)
and `stream.message` is only the **single most-recent** assistant message. So:
new user messages never appear, and each new turn replaces rather than appends —
only one turn is ever visible.
- Evidence: server thread has 6 messages; UI rendered only the first turn.
- Fix direction: accumulate the full transcript client-side — append the user
  message optimistically on send, and on each `chat.turn_end` fold the completed
  assistant message into a persistent list (or refetch the thread on turn end
  and merge by id). The `useChatStream` hook should expose completed turns, not
  just the in-flight one, or `chat-view` should maintain the running list.

## UI rebuild (2026-05-31) — composer + pickers + stream-merge

Driven by user feedback that the chat UI was buggy and hard to use: the composer
occupied ~20% of the page (a textarea row + a hint row + a *separate* picker bar
stacked above it) and the provider/model + thinking pickers sat outside the input
in a broken bar. Rebuilt to the ChatGPT/Claude single-box layout using our own
Linear-style monochrome palette.

- **Composer** (`chat-composer.tsx`): one rounded box. Textarea on top; a control
  row *inside* the same box holds the model + thinking pickers (left) and the
  send/stop button (right). One thin centered hint line. No separate bars.
- **Pickers** (`model-picker.tsx`, `thinking-picker.tsx`): compact in-composer
  triggers (model shows the friendly name, e.g. "MoonshotAI: Kimi K2.6"); both
  gained an `openUp` prop so the menu opens upward from the bottom composer.
- **Landing page** (`app/chat/page-client.tsx`): now has the same composer.
  Typing or picking a prompt creates a thread with the selected model and routes
  to `/chat/[threadId]?prompt=…`; `ChatView` reads the param once and auto-sends
  (wrapped in `<Suspense>` for `useSearchParams`).

### BUG-3 (frontend, high): doubled text + missing later turns on multi-turn — FIXED
Found during the rebuild's live test. `useChatStream` folded **every** frame in
the thread's replayed log onto a single `baseMessageRef` pinned to the *first*
turn's message id, ignoring each frame's `payload.messageId`. Result: a thread's
turn-2 deltas piled onto turn-1's message (rendered "APPLEAPPLE"-style doubling),
and the SSE replay-on-connect re-applied the same deltas. Fix: the hook now tracks
the newest `messageId` and rebuilds only that turn from an empty base, filtering
`newFrames` to the active id. Verified live: two-turn thread shows "APPLE" then
"BANANA" each exactly once, both before and after a full reload (replay path), and
input tokens grew 107→159 confirming multi-turn context (sessionPath) holds.

## pi error surfacing + full provider catalog (2026-05-31)

Two follow-up requests: (1) any error pi returns must be filtered and shown in
the UI; (2) the picker must list every provider/model pi supports, not just our
custom CrofAI provider.

### BUG-4 (bridge, high): pi errors silently swallowed as empty successful turns — FIXED
The pi `AgentEvent` union has **no `error` event**. A failed turn reaches
`agent_end` with its final `AssistantMessage` carrying `stopReason: "error"` +
`errorMessage`, and the assistant stream emits a terminal
`assistantMessageEvent` of `{ type: "error", reason, error }`. The bridge's
`agent_end` arm blindly emitted `turn_end` and the `message_update` arm only
handled `text_delta` — so provider/model errors (rate limits, missing keys,
upstream 5xx) rendered as a *successful* empty assistant turn.
Fix (`packages/pi-bridge/src/agent-session.ts`):
- `message_update` now maps `assistantMessageEvent.type === "error"` (reason
  `"error"`) → `PiBridgeEvent { kind: "error", text }`.
- `agent_end` checks the last assistant message's `stopReason`; on `"error"` it
  emits an error event (with `errorMessage`, falling back to naming the
  stopReason) instead of `turn_end`.
`runChatTurn` already maps `kind: "error"` → `chat.error` frame → message
`status: "error"`, and the UI renders the existing red error notice. Verified
live: selecting an unauthenticated Groq model and sending showed
"Stream error — auth error for provider groq: missing API key for groq …" in the
transcript instead of a blank turn. (REQ-052)

### All providers + models (REQ-040, REQ-044) — IMPLEMENTED
Previously `apps/dashboard/lib/chat/available-models.ts` ran client-side and
hardcoded only CrofAI (process.env is empty in the browser, so it could never
know the real catalog). Now:
- New bridge export `listAvailableProviders()` (Node-only) enumerates pi-ai's
  static catalog via `getProviders()`/`getModels()` **plus** the runtime-
  registered custom providers (CrofAI), flagging each `authenticated` via the
  same env/OAuth resolution session creation uses.
- New orchestrator endpoint `GET /api/chat/providers` returns it.
- The dashboard fetches it server-side and passes `providers` into `ChatView` /
  `ChatPageClient`; `available-models.ts` now just reshapes the fetched catalog
  (with a CrofAI-only fallback when the orchestrator is unreachable).
Verified live: the picker lists **32 providers / 973 models**, searchable
(e.g. "claude" surfaces Opus 4.1/4.5/4.6/4.7), authenticated providers sorted
first with per-provider connected/sign-in status.

## New-chat user-message loss + duplicated thinking blocks (2026-05-31)

### BUG-5 (frontend, high): first user message vanishes on a new chat — FIXED
On a brand-new thread the user bubble lives only in `baseMessages` via the
optimistic `startTurn` `onSuccess` append (`chat-view.tsx`). The turn-end
reconcile effect did `fetchQuery(getChatThread).then(setBaseMessages(d.messages))`
— a wholesale **replace**. With the QueryClient default `staleTime: 5_000` and no
per-query override, `fetchQuery` could return a cached snapshot taken *before*
the user message was persisted (it exists only ~5ms before the assistant row),
overwriting `baseMessages` with a user-less list. The assistant survived (it
comes from `stream.message`), so the UI showed "Thinking…" with no user bubble.
Fix: reconcile now (a) forces `staleTime: 0` so it never serves a pre-message
snapshot, and (b) **merges** server messages onto local by id via a new
`mergeMessageLists` helper (`chat-live-provider.tsx`) — server wins on conflicts,
local-only ids are preserved — so a stale/partial snapshot can't drop a known
message. Verified live: across a full new-chat turn (incl. error paths) the user
bubble was present at every poll and never dropped.

### BUG-6 (frontend, medium): one "Thought" box per reasoning burst — FIXED
A multi-step agent turn interleaves thinking and tool parts; the live reducer
(`chat-client.ts appendToPart`) starts a new `thinking` part after each tool
call, and `ChatMessage` rendered one `<ChatThinking>` per part → many boxes
(8 in the report), inconsistent with the persisted message (which joins thinking
into one). Fix (render-side only): `ChatMessage` joins all `thinking` parts in
arrival order into a single `<ChatThinking>` block. Verified live: a reasoning
turn shows exactly ONE "Thought" block; unit test covers the multi-burst→1
collapse with ordering preserved.

## Notes
- Stop-mid-stream and the send↔stop button toggle are unit-tested (Phase 5) and
  the cursor proves streaming state flips; a deterministic live stop screenshot
  was not captured because CrofAI turns complete faster than the manual capture
  window. The Playwright e2e spec (Phase 7) should assert stop via a slow/longer
  generation with polling.
- Both BUG-1 (sessionPath) and BUG-2 (transcript accumulation) were re-confirmed
  fixed during the rebuild run.
- Running the dashboard/orchestrator dev servers requires `CROFAI_API_KEY` sourced
  from project-root `.env.harness` into the process env (`set -a; source … ; set +a`),
  else the model picker shows "sign in" and turns return empty.
