"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { PriorityIcon, PRIORITY_LABELS, PRIORITY_ORDER, type Priority } from "./priority-icon";

export function PriorityPicker({
  name,
  defaultValue = "none",
}: {
  name: string;
  defaultValue?: Priority;
}) {
  const [value, setValue] = useState<Priority>(defaultValue);
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
    <div ref={rootRef} className="relative inline-block">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-8 items-center gap-2 rounded-md border bg-input px-3 text-[13px] transition-colors",
          open ? "border-st-progress" : "border-line hover:border-line-hover",
          value === "none" ? "text-fg-mute" : "text-fg-body",
        )}
      >
        <PriorityIcon value={value} />
        <span>{PRIORITY_LABELS[value]}</span>
        <svg viewBox="0 0 10 10" className="ml-1 h-2.5 w-2.5 text-fg-faint" aria-hidden="true">
          <path
            d="M 2.2 3.8 L 5 6.6 L 7.8 3.8"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[220px] rounded-lg border border-line-hover bg-card p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          {PRIORITY_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={value === p}
              onClick={() => {
                setValue(p);
                setOpen(false);
              }}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13px] text-fg-body",
                value === p ? "bg-st-progress/[0.12]" : "hover:bg-white/[0.04]",
              )}
            >
              <PriorityIcon value={p} />
              <span>{PRIORITY_LABELS[p]}</span>
              {value === p && (
                <svg viewBox="0 0 12 12" className="ml-auto h-3 w-3 text-st-progress" aria-hidden="true">
                  <path
                    d="M 2.5 6.2 L 5 8.6 L 9.5 3.6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
