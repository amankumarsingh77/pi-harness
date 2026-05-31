"use client";

import { useRef, type ReactNode } from "react";
import { clsx } from "clsx";

type Props = {
  readonly streaming: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  /** Model + thinking pickers, rendered inside the composer's control row. */
  readonly modelPicker?: ReactNode;
  readonly thinkingPicker?: ReactNode;
};

/**
 * Single-box composer (ChatGPT/Claude-style): textarea on top, a control row
 * inside the same box with the model + thinking pickers on the left and the
 * send/stop button on the right. Auto-grows up to 200px. Send becomes a red
 * stop square while streaming. Rejects empty/whitespace (EDGE-007). (REQ-030)
 */
export function ChatComposer({ streaming, onSend, onStop, modelPicker, thinkingPicker }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSend() {
    const value = textareaRef.current?.value ?? "";
    if (!value.trim()) return; // EDGE-007: reject empty/whitespace
    onSend(value.trim());
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) return; // don't send while streaming
      handleSend();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  return (
    <div
      data-testid="chat-composer"
      className="flex-none px-6 pb-4 pt-2"
    >
      <div className="mx-auto max-w-[760px]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-input)] px-1 pb-1 pt-1 transition-colors focus-within:border-[var(--color-line-strong)]">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Ask about the codebase…"
            onKeyDown={handleKeyDown}
            onChange={handleInput}
            className="w-full resize-none border-none bg-transparent px-3 pb-1 pt-2.5 text-[13.5px] leading-[1.5] text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-faint)]"
            style={{ minHeight: "24px", maxHeight: "200px" }}
          />

          {/* control row — pickers left, send/stop right, all inside the box */}
          <div className="flex items-center gap-1 px-1 pb-0.5">
            {modelPicker}
            {thinkingPicker}

            {/* send / stop button */}
            <button
              type="button"
              aria-label={streaming ? "Stop" : "Send"}
              onClick={streaming ? onStop : handleSend}
              className={clsx(
                "ml-auto inline-flex h-[30px] w-[30px] items-center justify-center rounded-full transition-colors",
                streaming
                  ? "stop bg-[var(--color-st-blocked)] text-white hover:bg-[#f06363]"
                  : "bg-[var(--color-fg)] text-[var(--color-bg)] hover:bg-white",
              )}
            >
              {streaming ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="3" y="3" width="6" height="6" rx="1" fill="currentColor" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <path d="M6.5 11V2M3 5.5L6.5 2l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* single thin hint line — no vertical bulk */}
        <p className="mt-1.5 text-center text-[10.5px] text-[var(--color-fg-faint)]">
          <span className="font-mono">↵</span> send · <span className="font-mono">⇧↵</span> newline · Read-only — won&apos;t modify files
        </p>
      </div>
    </div>
  );
}
