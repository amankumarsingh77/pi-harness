"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

type Props = {
  readonly text: string;
  readonly durationSecs?: number;
  /**
   * While the turn streams, the block auto-expands so reasoning is visible as it
   * arrives; it auto-collapses once the turn finishes (matches Claude/ChatGPT).
   * A manual toggle by the user overrides this.
   */
  readonly streaming?: boolean;
};

/**
 * Collapsible thinking block. Auto-open while streaming, collapsed once done.
 * Renders nothing when text is empty (EDGE-005).
 * Pattern: agent-log.tsx useState + chevron + aria-expanded.
 */
export function ChatThinking({ text, durationSecs, streaming = false }: Props) {
  const [open, setOpen] = useState(streaming);
  const userToggledRef = useRef(false);

  // Follow the streaming state until the user takes manual control: open while
  // reasoning streams in, collapse when the turn completes.
  useEffect(() => {
    if (!userToggledRef.current) setOpen(streaming);
  }, [streaming]);

  // EDGE-005: render nothing when text is empty
  if (!text) return null;

  return (
    <div
      data-testid="chat-thinking"
      className="mb-3 overflow-hidden rounded-lg border border-[var(--color-line)] bg-white/[0.012]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          userToggledRef.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-[11.5px] text-[var(--color-fg-mute)] hover:text-[var(--color-fg-body)]"
      >
        {/* chevron */}
        <svg
          className={clsx(
            "h-2.5 w-2.5 flex-none text-[var(--color-fg-faint)] transition-transform duration-150",
            open && "rotate-90",
          )}
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
        >
          <path
            d="M3.5 2L7 5L3.5 8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[var(--color-fg-body)]">{streaming ? "Thinking…" : "Thought"}</span>
        {durationSecs !== undefined && durationSecs > 0 && (
          <span className="ml-auto font-mono text-[10.5px] text-[var(--color-fg-faint)]">
            for {durationSecs}s
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--color-line)] pb-3 pl-8 pr-3 pt-2.5 text-[12.5px] leading-relaxed text-[var(--color-fg-mute)]">
          {text}
        </div>
      )}
    </div>
  );
}
