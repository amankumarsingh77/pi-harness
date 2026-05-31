"use client";

/**
 * useChatStream — EventSource lifecycle hook for a single chat thread.
 *
 * Mirrors use-events.ts patterns (open/close, seenRef dedupe, connected state).
 * Uses buildChatStreamUrl and parseChatFrame from chat-client.ts.
 *
 * REQ-011, REQ-014, REQ-050, REQ-051, REQ-052
 * EDGE-003
 */

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatStreamFrame } from "@pi-harness/shared";
import { isChatStreamKind } from "@pi-harness/shared";
import { buildChatStreamUrl, mergeChatFrames, parseChatFrame, reduceChatFrames } from "./chat-client";

// Terminal frame kinds — once received, streaming is complete.
const TERMINAL_KINDS = new Set(["chat.turn_end", "chat.stopped", "chat.error"]);

export type UseChatStreamResult = {
  /** Accumulated ChatMessage built from frames, or null before first frame. */
  readonly message: ChatMessage | null;
  /** Raw deduplicated frames received so far. */
  readonly frames: readonly ChatStreamFrame[];
  /** Whether the EventSource is currently open. */
  readonly connected: boolean;
  /**
   * True while the turn is in progress (no terminal frame received yet).
   * Drives the streaming cursor and composer stop-button.
   */
  readonly streaming: boolean;
};

/**
 * Opens an EventSource at the chat proxy URL for the given threadId.
 * Accumulates frames, dedupes by id, and folds them into a ChatMessage
 * via the pure reducer. Exposes `streaming` = no terminal frame yet.
 *
 * The browser's EventSource handles reconnect + Last-Event-ID resume.
 */
export function useChatStream(threadId: string): UseChatStreamResult {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  const [frames, setFrames] = useState<ChatStreamFrame[]>([]);
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  // Stable ref to accumulated frames so the event handler captures the latest
  const framesRef = useRef<ChatStreamFrame[]>([]);
  // Id of the turn currently being accumulated. A thread's frame log spans many
  // turns; `stream.message` represents only the latest one, so we fold frames
  // belonging to this id alone — otherwise every turn's deltas pile onto one
  // message (doubled text, missing later turns).
  const currentMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset all state for new threadId
    setMessage(null);
    setFrames([]);
    setConnected(false);
    setStreaming(false);
    seenRef.current = new Set();
    framesRef.current = [];
    currentMessageIdRef.current = null;

    let cancelled = false;

    const url = buildChatStreamUrl(threadId);
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      if (!cancelled) setConnected(true);
    };

    es.onerror = () => {
      if (!cancelled) setConnected(false);
    };

    // Handler for each chat frame kind
    const handleFrame = (ev: MessageEvent<string>): void => {
      if (cancelled) return;
      const frame = parseChatFrame(ev.data);
      if (!frame) return;
      if (!isChatStreamKind(frame.kind)) return;
      if (seenRef.current.has(frame.id)) return;
      seenRef.current.add(frame.id);

      const newFrames = mergeChatFrames(framesRef.current, [frame]);
      framesRef.current = newFrames;
      setFrames(newFrames);

      // Each frame carries the assistant message it belongs to. A thread's
      // frame log spans every turn (and is fully replayed on reconnect), so a
      // later turn's frames must NOT fold onto an earlier turn — track the
      // newest message id and rebuild only that turn from the empty base.
      const { messageId } = frame.payload as { messageId: string };
      if (currentMessageIdRef.current !== messageId) {
        currentMessageIdRef.current = messageId;
      }
      const activeId = currentMessageIdRef.current;

      const base: ChatMessage = {
        id: activeId,
        threadId,
        role: "assistant",
        createdAt: frame.ts,
        parts: [],
        status: "streaming",
      };

      // Fold only the frames belonging to the active turn (idempotent under
      // replay — deduped by id upstream, keyed by messageId here).
      const turnFrames = newFrames.filter(
        (f) => (f.payload as { messageId?: string }).messageId === activeId,
      );
      const updated = reduceChatFrames(base, turnFrames);
      setMessage(updated);

      const isTerminal =
        TERMINAL_KINDS.has(frame.kind) && messageId === activeId;
      setStreaming(!isTerminal);
    };

    // Register listeners for all chat stream kinds
    for (const kind of [
      "chat.delta",
      "chat.thinking",
      "chat.tool_call",
      "chat.tool_result",
      "chat.turn_end",
      "chat.stopped",
      "chat.error",
    ]) {
      es.addEventListener(kind, handleFrame);
    }

    return () => {
      cancelled = true;
      es.close();
    };
  }, [threadId]);

  return { message, frames, connected, streaming };
}
