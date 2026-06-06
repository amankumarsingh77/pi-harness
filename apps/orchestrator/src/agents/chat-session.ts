/**
 * chat-session.ts — Turn driver for the general codebase chat feature.
 *
 * Runs one agent turn via `createAgentSession`, translating each
 * `PiBridgeEvent` into a persisted + fanned-out `ChatStreamFrame`, and
 * supports abort via AbortSignal.
 *
 * Mirrors the brainstorm.ts driver pattern (see ~203-381) but simpler:
 * no task/run infrastructure, no multiple phases.
 *
 * REQ-010, REQ-011, REQ-013, REQ-014, REQ-031, REQ-032, REQ-050, REQ-052
 * EDGE-002, EDGE-004, EDGE-005
 */

import type { AgentSession, AgentSessionOptions, PiBridgeEvent } from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import type { ChatMessage, ChatMessagePart, ChatThread } from "@pi-harness/shared";
import type { ChatSessionStore } from "../adapters/chat-store.js";
import { makeGraphifyTools } from "./graphify-tools.js";
import type { GraphifyService } from "../services/graphify-service.js";

// ── Injectable type for tests ─────────────────────────────────────────────────

/** Mirrors the signature of `createAgentSession` from @pi-harness/pi-bridge. */
export type CreateAgentSessionFn = (opts: AgentSessionOptions) => Promise<AgentSession>;

// ── RunChatTurn options ───────────────────────────────────────────────────────

export type RunChatTurnOpts = {
  /** Working directory for the agent session. */
  readonly cwd: string;
  /** The thread — carries model + thinkingLevel. */
  readonly thread: ChatThread;
  /**
   * Pre-created assistant message id (caller creates it in `streaming` state
   * so the id exists before any frames flow).
   */
  readonly assistantMessageId: string;
  /** User prompt text. */
  readonly promptText: string;
  /** Store to persist frames and messages. */
  readonly store: Pick<ChatSessionStore, "publishFrame" | "appendMessage">;
  /** Injectable for tests — never hits the live SDK in tests. */
  readonly createAgentSession: CreateAgentSessionFn;
  readonly graphify?: GraphifyService;
  readonly graphifyQueryBudget?: number;
  /**
   * Per-thread session file. When set, the pi SDK persists and replays the
   * conversation across turns so follow-up prompts retain context. Without it
   * each turn is a fresh, contextless session (the cause of empty follow-ups).
   */
  readonly sessionPath?: string;
  /** Optional signal for cooperative cancellation. */
  readonly signal?: AbortSignal;
};

// ── Driver ────────────────────────────────────────────────────────────────────

/**
 * Run one chat turn.
 *
 * Event mapping (PiBridgeEvent → ChatStreamFrame kind):
 *   message_delta  → chat.delta
 *   tool_call      → chat.tool_call
 *   tool_result    → chat.tool_result
 *   turn_end       → chat.turn_end  (then finalize message complete + usage)
 *   error          → chat.error     (then finalize message error)
 *   log (thinking) → chat.thinking  (only if text is non-empty — EDGE-005)
 *   abort          → chat.stopped   (then finalize message stopped)
 *
 * EDGE-004: stop-after-turn_end is a no-op (guarded by `settled` flag).
 * EDGE-002: tool_result with unknown callId does not throw.
 * REQ-052: AuthError → single chat.error frame, message→error (not streaming).
 */
export async function runChatTurn(opts: RunChatTurnOpts): Promise<void> {
  const { cwd, thread, assistantMessageId, promptText, store, signal } = opts;

  // Accumulated parts as events arrive — used when finalizing the message.
  const accumulatedText: string[] = [];
  const accumulatedThinking: string[] = [];
  const accumulatedParts: ChatMessagePart[] = [];

  // Settled flag — once the turn has ended (turn_end, error, or stop), further
  // events are dropped (EDGE-004: stop-after-turn_end is a no-op).
  let settled = false;

  // Collect all pending async operations (publishFrame calls). We await these
  // after session.prompt() returns so runChatTurn doesn't return prematurely.
  const pending: Promise<unknown>[] = [];

  // Helper: finalize message with given status, parts, usage, error.
  // Uses the assistantMessageId so the store can deduplicate (last-write-wins)
  // and overwrite the initial streaming record.
  const finalizeMessage = (
    status: ChatMessage["status"],
    usage?: ChatMessage["usage"],
    error?: string,
  ): Promise<void> => {
    // Build final parts from accumulated state. Order mirrors the live stream:
    // thinking first, then tool calls, then the answer text.
    const textSoFar = accumulatedText.join("");
    const thinkingSoFar = accumulatedThinking.join("");
    const toolParts = accumulatedParts.filter((p) => p.kind === "tool");
    const finalParts: ChatMessagePart[] = [
      ...(thinkingSoFar.length > 0 ? [{ kind: "thinking" as const, text: thinkingSoFar }] : []),
      ...toolParts,
      ...(textSoFar.length > 0 ? [{ kind: "text" as const, text: textSoFar }] : []),
    ];

    return store.appendMessage(thread.id, {
      id: assistantMessageId,
      role: "assistant",
      parts: finalParts,
      status,
      ...(usage !== undefined ? { usage } : {}),
      ...(error !== undefined ? { error } : {}),
    }).then(() => undefined);
  };

  // Helper: publish a terminal frame then finalize the message, collecting the chain as a pending promise.
  const publishTerminalFrame = (
    frameInput: { readonly kind: "chat.turn_end"; readonly payload: { readonly messageId: string; readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number } } } |
               { readonly kind: "chat.error"; readonly payload: { readonly messageId: string; readonly text: string } } |
               { readonly kind: "chat.stopped"; readonly payload: { readonly messageId: string } },
    status: ChatMessage["status"],
    usage?: ChatMessage["usage"],
    error?: string,
  ): void => {
    const p = store.publishFrame(thread.id, frameInput)
      .then(() => finalizeMessage(status, usage, error));
    pending.push(p);
  };

  // Event handler: translate PiBridgeEvent → ChatStreamFrame
  const onEvent = (e: PiBridgeEvent): void => {
    if (settled) return; // EDGE-004

    switch (e.kind) {
      case "message_delta": {
        accumulatedText.push(e.text);
        pending.push(
          store.publishFrame(thread.id, {
            kind: "chat.delta",
            payload: { messageId: assistantMessageId, text: e.text },
          }),
        );
        break;
      }

      case "thinking_delta": {
        // EDGE-005: never emit empty thinking.
        if (e.text.length === 0) break;
        accumulatedThinking.push(e.text);
        pending.push(
          store.publishFrame(thread.id, {
            kind: "chat.thinking",
            payload: { messageId: assistantMessageId, text: e.text },
          }),
        );
        break;
      }

      case "tool_call": {
        // Track in parts (running state)
        accumulatedParts.push({
          kind: "tool",
          callId: e.callId,
          tool: e.tool,
          input: e.input,
          status: "running",
        });
        pending.push(
          store.publishFrame(thread.id, {
            kind: "chat.tool_call",
            payload: {
              messageId: assistantMessageId,
              callId: e.callId,
              tool: e.tool,
              input: e.input,
            },
          }),
        );
        break;
      }

      case "tool_result": {
        // Update matching tool part if it exists — EDGE-002: unknown callId is tolerated
        const idx = accumulatedParts.findIndex(
          (p) => p.kind === "tool" && p.callId === e.callId,
        );
        if (idx >= 0) {
          const existing = accumulatedParts[idx];
          if (existing !== undefined && existing.kind === "tool") {
            const updated: ChatMessagePart = {
              kind: "tool",
              callId: existing.callId,
              tool: existing.tool,
              input: existing.input,
              status: e.ok ? "ok" : "error",
              ...(e.output !== undefined ? { output: e.output } : {}),
            };
            accumulatedParts[idx] = updated;
          }
        }
        // Always emit the frame (even for unknown callId — EDGE-002)
        pending.push(
          store.publishFrame(thread.id, {
            kind: "chat.tool_result",
            payload: {
              messageId: assistantMessageId,
              callId: e.callId,
              tool: e.tool,
              ok: e.ok,
              ...(e.output !== undefined ? { output: e.output } : {}),
            },
          }),
        );
        break;
      }

      case "turn_end": {
        if (settled) return;
        settled = true;
        const usage: ChatMessage["usage"] = {
          inputTokens: e.usage.inputTokens,
          outputTokens: e.usage.outputTokens,
          costUsd: e.usage.costUsd,
        };
        publishTerminalFrame(
          { kind: "chat.turn_end", payload: { messageId: assistantMessageId, usage: e.usage } },
          "complete",
          usage,
        );
        break;
      }

      case "error": {
        if (settled) return;
        settled = true;
        publishTerminalFrame(
          { kind: "chat.error", payload: { messageId: assistantMessageId, text: e.text } },
          "error",
          undefined,
          e.text,
        );
        break;
      }

      case "log": {
        // The SDK surfaces reasoning as log events (thinking channel).
        // Keep mapping conservative: no user-facing frame for generic logs.
        // EDGE-005: never emit empty thinking. When the SDK surfaces a distinct
        // thinking_delta event, map it here to chat.thinking (if non-empty).
        break;
      }

      default:
        break;
    }
  };

  // ── Create agent session ────────────────────────────────────────────────────

  let session: AgentSession;
  try {
    const graphifyTools = opts.graphify
      ? makeGraphifyTools({
          graphify: opts.graphify,
          defaultBudget: opts.graphifyQueryBudget ?? 2000,
        })
      : [];
    session = await opts.createAgentSession({
      cwd,
      model: { provider: thread.model.provider, model: thread.model.model },
      ...(thread.model.thinkingLevel !== "off"
        ? { thinkingLevel: thread.model.thinkingLevel }
        : {}),
      ...(opts.sessionPath !== undefined ? { sessionPath: opts.sessionPath } : {}),
      ...(graphifyTools.length > 0
        ? {
            customTools: [...graphifyTools],
          }
        : {}),
      onEvent,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // REQ-052: name the provider, don't leave message streaming
      const text = `auth error for provider ${thread.model.provider}: ${err.message}`;
      await store.publishFrame(thread.id, {
        kind: "chat.error",
        payload: { messageId: assistantMessageId, text },
      });
      await finalizeMessage("error", undefined, text);
      return;
    }
    // Non-auth errors: surface as chat.error
    const text = err instanceof Error ? err.message : String(err);
    await store.publishFrame(thread.id, {
      kind: "chat.error",
      payload: { messageId: assistantMessageId, text },
    });
    await finalizeMessage("error", undefined, text);
    return;
  }

  // ── Abort wire-up ───────────────────────────────────────────────────────────

  const doAbort = (): void => {
    if (settled) return; // EDGE-004: already finished, no-op
    settled = true;
    void session.abort().catch(() => {});
    publishTerminalFrame(
      { kind: "chat.stopped", payload: { messageId: assistantMessageId } },
      "stopped",
    );
  };

  if (signal?.aborted) {
    doAbort();
    await session.close().catch(() => {});
    await Promise.allSettled(pending);
    return;
  }
  signal?.addEventListener("abort", doAbort, { once: true });

  // ── Run the turn ────────────────────────────────────────────────────────────

  try {
    await session.prompt(promptText);
  } catch (err) {
    signal?.removeEventListener("abort", doAbort);
    await session.close().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    if (signal?.aborted || message === "aborted") {
      if (!settled) {
        settled = true;
        publishTerminalFrame(
          { kind: "chat.stopped", payload: { messageId: assistantMessageId } },
          "stopped",
        );
      }
      await Promise.allSettled(pending);
      return;
    }
    if (!settled) {
      settled = true;
      publishTerminalFrame(
        { kind: "chat.error", payload: { messageId: assistantMessageId, text: message } },
        "error",
        undefined,
        message,
      );
    }
    await Promise.allSettled(pending);
    return;
  }

  signal?.removeEventListener("abort", doAbort);
  await session.close().catch(() => {});

  // Await all pending frame publishes + finalizations
  await Promise.allSettled(pending);
}
