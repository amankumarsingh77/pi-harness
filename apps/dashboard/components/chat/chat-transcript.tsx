"use client";

import { useEffect, useRef } from "react";
import { ChatMessage } from "./chat-message";
import type { ChatMessage as ChatMessageType } from "@pi-harness/shared";

type Props = {
  readonly messages: readonly ChatMessageType[];
  readonly streaming: boolean;
  /**
   * True while a turn is active but the assistant hasn't produced any visible
   * output yet. Renders an animated pending row so the send→stop transition has
   * matching feedback in the transcript. (REQ-011/012)
   */
  readonly awaitingResponse?: boolean;
};

/**
 * Maps an array of ChatMessages to ChatMessage rows.
 * Auto-scrolls to bottom while streaming. no-scrollbar for Linear-style aesthetics.
 * Long turns bounded by the card layout (EDGE-008). (REQ-011)
 */
export function ChatTranscript({ messages, streaming, awaitingResponse = false }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while a turn is in flight (streaming or awaiting).
  useEffect(() => {
    if (streaming || awaitingResponse) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, streaming, awaitingResponse]);

  return (
    <section
      data-testid="chat-transcript"
      className="no-scrollbar min-h-0 flex-1 overflow-y-auto"
    >
      <div
        data-testid="transcript-stream"
        className="mx-auto max-w-[760px] px-6 pb-10 pt-[26px]"
      >
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {awaitingResponse && <PendingRow />}
        <div ref={endRef} />
      </div>
    </section>
  );
}

/**
 * Pending assistant row shown the instant a turn starts, before the first
 * token. Mirrors the assistant message layout (pi avatar + content column).
 */
function PendingRow() {
  return (
    <article data-testid="chat-pending" className="mb-[26px] flex gap-3" aria-live="polite">
      <div className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] border border-[var(--color-line)] bg-[var(--color-sub)] font-mono text-[10.5px] font-semibold text-[var(--color-st-progress)]">
        pi
      </div>
      <div className="flex min-h-[26px] items-center pt-0.5">
        <span className="flex items-center gap-1 text-[13px] text-[var(--color-fg-mute)]">
          <span className="typing-dot" />
          <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
          <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
        </span>
      </div>
    </article>
  );
}
