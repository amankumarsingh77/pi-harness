"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { ChatThinkingLevel } from "@pi-harness/shared";

const LEVELS: { value: ChatThinkingLevel; label: string; description: string }[] = [
  { value: "off",    label: "Off",    description: "No reasoning — fastest" },
  { value: "low",    label: "Low",    description: "Brief reasoning" },
  { value: "medium", label: "Medium", description: "Balanced — default" },
  { value: "high",   label: "High",   description: "Deep reasoning — slower" },
];

type Props = {
  readonly level: ChatThinkingLevel;
  readonly onSelect: (level: ChatThinkingLevel) => void;
  /** When true the menu opens upward (used inside the bottom composer). */
  readonly openUp?: boolean;
};

const LEVEL_LABEL: Record<ChatThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * Thinking-level picker: off / low / medium / high with descriptions.
 * Pattern: priority-picker.tsx — mousedown click-away, Escape. (REQ-042/043)
 */
export function ThinkingPicker({ level, onSelect, openUp = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-testid="thinking-picker">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`thinking · ${level}`}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
          open
            ? "bg-[var(--color-card-hover)] text-[var(--color-fg)]"
            : "text-[var(--color-fg-mute)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg-body)]",
        )}
      >
        <svg className="h-[13px] w-[13px] flex-none text-[var(--color-fg-faint)]" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M6.5 1.2v1.6M6.5 10.2v1.6M1.2 6.5h1.6M10.2 6.5h1.6M2.8 2.8l1.1 1.1M9.1 9.1l1.1 1.1M2.8 10.2l1.1-1.1M9.1 3.9l1.1-1.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
        <span>{LEVEL_LABEL[level]}</span>
        <svg className="h-[9px] w-[9px] flex-none text-[var(--color-fg-faint)]" viewBox="0 0 9 9" fill="none" aria-hidden>
          <path d="M2 3.5L4.5 6L7 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Thinking level"
          className={clsx(
            "absolute left-0 z-50 w-[232px] overflow-hidden rounded-[11px] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[0_12px_32px_rgba(0,0,0,0.55),0_0_0_1px_rgba(0,0,0,0.3)]",
            openUp ? "bottom-[calc(100%+7px)]" : "top-[calc(100%+7px)]",
          )}
        >
          <div className="p-[5px]">
            {LEVELS.map((opt) => {
              const isSel = level === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  data-testid={`think-opt-${opt.value}`}
                  onClick={() => {
                    onSelect(opt.value);
                    setOpen(false);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-[7px] px-[9px] py-2 text-left transition-colors",
                    isSel ? "bg-[var(--color-sub)]" : "hover:bg-[var(--color-card-hover)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block text-[12.5px]", isSel ? "text-[var(--color-fg)]" : "text-[var(--color-fg-body)]")}>
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-[var(--color-fg-faint)]">{opt.description}</span>
                  </span>
                  <svg
                    className={clsx("h-[13px] w-[13px] flex-none text-[var(--color-st-progress)] transition-opacity", isSel ? "opacity-100" : "opacity-0")}
                    viewBox="0 0 13 13"
                    fill="none"
                    aria-hidden
                  >
                    <path d="M2.5 6.8L5 9.3L10.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
