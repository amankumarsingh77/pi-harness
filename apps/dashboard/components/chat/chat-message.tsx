"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";
import { ChatThinking } from "./chat-thinking";
import { ChatToolCall } from "./chat-tool-call";
import type { ChatMessage as ChatMessageType } from "@pi-harness/shared";

type Props = {
  readonly message: ChatMessageType;
};

/**
 * Renders a single chat turn (user or assistant).
 * - User: bubble with the text, "A" avatar.
 * - Assistant: "pi" avatar + parts (thinking, tool calls, text with optional cursor).
 * - Stopped/error notices appended after assistant content (REQ-011/012/020/032/052).
 */
export function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.parts
      .filter((p) => p.kind === "text")
      .map((p) => (p.kind === "text" ? p.text : ""))
      .join("");

    return (
      <article
        data-testid="chat-message-user"
        className="mb-[26px] flex gap-3"
      >
        {/* avatar */}
        <div className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] border border-[var(--color-line)] bg-transparent font-mono text-[10.5px] font-semibold text-[var(--color-fg-body)]">
          A
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[13.5px] leading-[1.55] text-[var(--color-fg)]">{text}</p>
        </div>
      </article>
    );
  }

  // ── Assistant turn ────────────────────────────────────────────────────────
  const isStreaming = message.status === "streaming";
  const isStopped = message.status === "stopped";
  const isError = message.status === "error";
  const isComplete = message.status === "complete";

  // Collect text parts for markdown rendering
  const textParts = message.parts.filter((p) => p.kind === "text");
  const fullText = textParts.map((p) => (p.kind === "text" ? p.text : "")).join("");

  // All reasoning bursts joined in arrival order → one thinking block.
  const thinkingText = message.parts
    .filter((p) => p.kind === "thinking")
    .map((p) => (p.kind === "thinking" ? p.text : ""))
    .filter((t) => t.length > 0)
    .join("\n\n");

  return (
    <article
      data-testid="chat-message-assistant"
      className="mb-[26px] flex gap-3"
    >
      {/* pi avatar */}
      <div className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] border border-[var(--color-line)] bg-[var(--color-sub)] font-mono text-[10.5px] font-semibold text-[var(--color-st-progress)]">
        pi
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        {/* thinking — a multi-step turn produces one thinking part per reasoning
            burst (split by interleaved tool calls). Join them in arrival order
            into a single collapsible block so the live view matches the
            already-joined persisted message and the user sees one "Thought". */}
        {thinkingText && <ChatThinking text={thinkingText} streaming={isStreaming} />}

        {/* tool call parts */}
        {message.parts.some((p) => p.kind === "tool") && (
          <div className="mb-3 flex flex-col gap-[5px]">
            {message.parts
              .filter((p) => p.kind === "tool")
              .map((p) =>
                p.kind === "tool" ? (
                  <ChatToolCall
                    key={p.callId}
                    callId={p.callId}
                    tool={p.tool}
                    input={p.input}
                    status={p.status}
                    output={p.output}
                  />
                ) : null,
              )}
          </div>
        )}

        {/* prose (markdown) */}
        {fullText && (
          <div
            className={clsx(
              "markdown-body text-[13.5px] leading-[1.65] text-[var(--color-fg-body)]",
            )}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullText}</ReactMarkdown>
            {isStreaming && <span className="cursor" aria-hidden />}
          </div>
        )}

        {/* stopped notice */}
        {isStopped && (
          <div
            data-testid="notice-stopped"
            className="mt-1 flex items-start gap-2 rounded-lg border border-[var(--color-line)] bg-white/[0.012] px-3 py-2.5 text-[12px] text-[var(--color-fg-mute)]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              aria-hidden
              className="mt-px flex-none"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <span>Stopped by you · partial response kept.</span>
          </div>
        )}

        {/* error notice */}
        {isError && (
          <div
            data-testid="notice-error"
            className="mt-1 flex items-start gap-2 rounded-lg border border-[rgba(235,87,87,0.3)] bg-[rgba(235,87,87,0.06)] px-3 py-2.5 text-[12px] text-[var(--color-red-fg)]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              aria-hidden
              className="mt-px flex-none"
            >
              <path d="M6.5 1.5L12 11H1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              <path d="M6.5 5v2.5M6.5 9h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>
              {message.error
                ? `Stream error — ${message.error}`
                : "Stream interrupted — orchestrator unreachable. Reconnecting…"}
            </span>
          </div>
        )}

        {/* usage footer (complete turn) */}
        {isComplete && message.usage && (
          <div
            data-testid="msg-usage"
            className="mt-[11px] flex items-center gap-[14px] font-mono text-[11px] text-[var(--color-fg-faint)]"
          >
            <span>{message.usage.inputTokens.toLocaleString()} in / {message.usage.outputTokens.toLocaleString()} out</span>
            <span>${message.usage.costUsd.toFixed(4)}</span>
          </div>
        )}
      </div>
    </article>
  );
}
