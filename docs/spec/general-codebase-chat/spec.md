# SPEC: General Codebase Chat

**Source:** docs/spec/general-codebase-chat/design.md
**Generated:** 2026-05-30
**Visual contract:** [`docs/mocks/general-chat-v2-2026-05-30.html`](../../mocks/general-chat-v2-2026-05-30.html) — every UI requirement below is measured against this approved mock (layout, Linear-style theme, interaction states).

## Requirements

### Chat surface & navigation

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall expose a `/chat` route in the dashboard reachable from a "Chat" entry in the topbar nav. | Navigating to `/chat` renders the chat page; `topbar-nav` shows a "Chat" link that is active on `/chat*`. | Must |
| REQ-002 | State-driven | While no thread is selected, the system shall render an empty state with a heading, a one-line read-only disclaimer, and suggested prompt cards. | Empty state matches the mock's `#scn-empty`: kicker, title, sub, 4 prompt cards. | Must |
| REQ-003 | Ubiquitous | The system shall render a chat-history rail listing prior threads grouped by recency, each showing a title and a branch + relative-time meta line. | Rail lists threads; each has title + `mono` meta; matches mock `.rail`. Collapses below the responsive breakpoint to a "Chats" trigger. | Must |

### Streaming a turn

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-010 | Event-driven | When the user submits a message, the system shall append it to the thread and start an agent turn via `pi-bridge` `createAgentSession`. | `POST /api/chat/threads/:id/messages` appends a user message and invokes `session.prompt(text)`; returns 2xx before the turn completes. | Must |
| REQ-011 | Event-driven | When the agent emits a `message_delta` event, the system shall append the delta to the in-progress assistant message and stream it to subscribed clients over SSE. | A `chat.delta` SSE frame is emitted per `message_delta`; the transcript shows appended text with a streaming cursor while the turn is active. | Must |
| REQ-012 | State-driven | While an assistant turn is streaming, the system shall display a live status indicator and render a blinking cursor at the end of the streamed text. | Topbar live chip reads "streaming"; `.cursor` present until `chat.turn_end`. | Must |
| REQ-013 | Event-driven | When the agent emits a `turn_end` event, the system shall finalize the assistant message and record usage (input/output tokens, cost). | `chat.turn_end` frame carries usage; cursor removed; message marked complete; usage stored on the message. | Must |
| REQ-014 | Ubiquitous | The SSE stream shall assign each frame a monotonic sequence id and support resume via `last-event-id`. | Frames carry `id: <sequence>`; reconnecting with `last-event-id` replays only frames after that sequence. | Must |

### Thinking & tool calls

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-020 | Event-driven | When the agent produces reasoning/thinking output, the system shall render it inside a collapsible block that is collapsed by default once the turn completes. | Thinking renders in a `<details>`-style block with a toggle; matches mock `.thinking`; expand/collapse toggles visibility. | Must |
| REQ-021 | Event-driven | When the agent emits a `tool_call` event, the system shall render a tool-call card showing the tool name and its input arguments. | `chat.tool_call` frame → card with `tool-name` + `tool-arg`; matches mock `.tool`. | Must |
| REQ-022 | State-driven | While a tool call has no result yet, the system shall show that tool card in a "running" state. | Card shows `st-run` running indicator until the matching `chat.tool_result`. | Must |
| REQ-023 | Event-driven | When the agent emits a `tool_result` event, the system shall update the matching tool card to show success or error and (when present) the result output. | `chat.tool_result` frame → card transitions to `st-ok`/`st-err`, keyed by `callId`. | Must |

### Termination

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-030 | State-driven | While a turn is streaming, the system shall present a stop control (composer send button becomes a stop control, plus a topbar Stop affordance). | During streaming the send button renders as the red stop square per the mock; a `Stop` chip is present. | Must |
| REQ-031 | Event-driven | When the user activates the stop control, the system shall abort the agent session and stop emitting further deltas for that turn. | `POST /api/chat/threads/:id/stop` calls `session.abort()`; no `chat.delta` frames after the stop. | Must |
| REQ-032 | Event-driven | When a turn is stopped by the user, the system shall preserve the partial assistant text already received and display a "stopped by user" notice. | Partial text retained; a stopped notice renders (mock `.notice.stopped`); a terminal `chat.stopped` frame is emitted. | Must |

### Provider / model / thinking selection

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-040 | Ubiquitous | The system shall present a model picker grouped by provider, listing each model's id and (when known) context window, cost, and a reasoning indicator. | Picker matches mock: provider groups (CrofAI, Anthropic, OpenAI·Codex), per-model id + meta + `reasoning` tag where applicable. | Must |
| REQ-041 | Event-driven | When the user selects a model, the system shall update the active model selection for the thread and reflect it in the topbar trigger and the composer pill. | Selecting an option updates both labels to `<provider>/<model>` and persists as the thread's selection for subsequent turns. | Must |
| REQ-042 | Ubiquitous | The system shall present a thinking-level picker offering off / low / medium / high. | Picker lists 4 levels with descriptions; current selection checked; matches mock `.thinking-menu`. | Must |
| REQ-043 | Event-driven | When the user changes the thinking level, the system shall apply it to subsequent turns via the session's `thinkingLevel` option. | Selecting a level updates the label and is passed to `createAgentSession`. | Should |
| REQ-044 | Unwanted | If a provider has no configured credential, then the system shall mark it as unauthenticated in the picker rather than offering it as ready. | Provider group shows a "sign in" / unauthenticated marker (mock `.auth.off`); selecting it does not start a turn that 500s silently. | Should |

### Persistence & error handling

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-050 | Event-driven | When a thread is created or a message is appended, the system shall persist it so the thread and its messages survive an orchestrator restart. | Threads + messages persisted (JSONL, matching existing store patterns); `GET /api/chat/threads/:id` returns prior messages after restart. | Must |
| REQ-051 | Unwanted | If the orchestrator is unreachable during streaming, then the system shall surface a reconnect notice and resume from the last received sequence. | Client shows error/reconnect notice (mock `.notice.error`); on reconnect, resumes via `last-event-id` without duplicating rendered frames. | Should |
| REQ-052 | Unwanted | If `createAgentSession` raises an auth error, then the system shall emit a `chat.error` frame naming the provider and not leave the turn in a perpetual "streaming" state. | Auth failure → `chat.error` frame; live status leaves "streaming"; UI shows the error notice. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | User sends a second message while the first turn is still streaming. | Either the composer is disabled during streaming, or the new message queues after the active turn ends — never interleaves two turns into one assistant message. | REQ-010, REQ-011 |
| EDGE-002 | `tool_result` arrives for a `callId` with no preceding `tool_call` (out-of-order / dropped frame). | Reducer tolerates it: no crash; either creates a result-only card or ignores it; never throws. | REQ-021, REQ-023 |
| EDGE-003 | Stream reconnects and replays frames the client already rendered. | Frames are merged by id/sequence; no duplicate text or duplicate tool cards. | REQ-014, REQ-051 |
| EDGE-004 | User clicks stop after `turn_end` has already arrived (race). | Stop is a no-op on a completed turn; no error; UI stays in completed state. | REQ-031, REQ-013 |
| EDGE-005 | Thinking block receives no thinking content for a turn (thinking off / model emits none). | No empty thinking block is rendered. | REQ-020, REQ-042 |
| EDGE-006 | Model selection references a provider whose key is absent. | Picker marks it unauthenticated; if selected and sent, a `chat.error` surfaces instead of a hang. | REQ-044, REQ-052 |
| EDGE-007 | Empty or whitespace-only message submitted. | Submission is rejected client-side; no turn starts. | REQ-010 |
| EDGE-008 | Very long assistant response / many tool calls in one turn. | Transcript scrolls; tool output is bounded (scroll within card) per the mock; layout does not break. | REQ-011, REQ-021 |

## Verification Matrix

| REQ/EDGE ID | Unit | Integration | E2E | Manual (Playwright MCP) | Notes |
|-------------|------|-------------|-----|-------------------------|-------|
| REQ-001 | Yes | No | Yes | Yes (ui) | topbar link + route render |
| REQ-002 | Yes | No | No | Yes (ui) | empty-state component |
| REQ-003 | Yes | No | No | Yes (ui) | rail component + responsive |
| REQ-010 | Yes | Yes | Yes | No | route + store append |
| REQ-011 | Yes | Yes | Yes | Yes (ui) | delta reducer + streaming render |
| REQ-012 | Yes | No | No | Yes (ui) | cursor + live status |
| REQ-013 | Yes | Yes | No | No | turn_end + usage |
| REQ-014 | Yes | Yes | No | No | sequence + resume |
| REQ-020 | Yes | No | No | Yes (ui) | thinking collapse |
| REQ-021 | Yes | No | No | Yes (ui) | tool_call card |
| REQ-022 | Yes | No | No | Yes (ui) | running state |
| REQ-023 | Yes | Yes | No | Yes (ui) | tool_result keyed by callId |
| REQ-030 | Yes | No | No | Yes (ui) | stop control render |
| REQ-031 | Yes | Yes | Yes | No | abort route |
| REQ-032 | Yes | Yes | No | Yes (ui) | partial preserved + notice |
| REQ-040 | Yes | No | No | Yes (ui) | model picker render |
| REQ-041 | Yes | No | Yes | Yes (ui) | select → label propagation |
| REQ-042 | Yes | No | No | Yes (ui) | thinking picker |
| REQ-043 | Yes | Yes | No | No | level passed to session |
| REQ-044 | Yes | No | No | Yes (ui) | unauthenticated marker |
| REQ-050 | Yes | Yes | No | No | persistence across restart |
| REQ-051 | Yes | No | No | Yes (ui) | reconnect notice |
| REQ-052 | Yes | Yes | No | Yes (ui) | error frame + status reset |
| EDGE-001 | Yes | No | No | No | concurrent send guard |
| EDGE-002 | Yes | No | No | No | reducer tolerance |
| EDGE-003 | Yes | Yes | No | No | merge dedupe |
| EDGE-004 | Yes | No | No | No | stop-after-end race |
| EDGE-005 | Yes | No | No | No | no empty thinking block |
| EDGE-006 | Yes | No | No | No | absent-key path |
| EDGE-007 | Yes | No | No | No | empty message reject |
| EDGE-008 | Yes | No | No | Yes (ui) | long-turn layout |

## Verification Scenarios

### VS-0-crofai-chat-roundtrip: Library probe — pi-bridge + CrofAI streaming round-trip
**Type:** api
**Run:** `set -a; source "$(dirname "$(git rev-parse --git-common-dir)")/.env.harness"; set +a; node .harness/general-codebase-chat/probes/crofai/probe-chat-roundtrip.mjs`
**Expected:** exit 0; stdout JSON has `sawDelta: true` and `sawTurnEnd: true`; `turn_end` usage with `outputTokens > 0`.
**Source:** library-probe (VS-0), re-run by functional-verify.

## Out of Scope

- Editable / write-enabled chat: the agent does not modify files from chat. No task handoff from a thread.
- Multi-user accounts, auth, or per-user thread isolation (dashboard is single-operator).
- Semantic / ranked search over threads — rail search is a simple title filter only.
- File / image attachments or multimodal input.
- Streaming markdown re-layout optimizations beyond what `react-markdown` already provides.
- Anthropic fallback is runtime-selectable but its live verification is deferred (no key configured).
