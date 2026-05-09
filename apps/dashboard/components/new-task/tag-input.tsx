"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { clsx } from "clsx";

const SUGGESTIONS = ["bugfix", "perf", "refactor", "infra", "frontend"] as const;

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function TagInput({
  name,
  defaultValue = [],
}: {
  name: string;
  defaultValue?: readonly string[];
}) {
  const [tags, setTags] = useState<string[]>([...defaultValue]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const v = normalize(raw);
    if (!v || tags.includes(v)) return;
    setTags((t) => [...t, v]);
  };
  const remove = (v: string) => setTags((t) => t.filter((x) => x !== v));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
      setDraft("");
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      const last = tags[tags.length - 1];
      if (last !== undefined) remove(last);
    }
  };

  const available = SUGGESTIONS.filter((s) => !tags.includes(s));

  return (
    <div>
      {tags.map((t) => (
        <input key={t} type="hidden" name={name} value={t} />
      ))}
      <div
        className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-line bg-input px-2 py-1.5 transition-colors focus-within:border-st-progress"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex h-[22px] items-center gap-1.5 rounded border border-line bg-white/[0.04] pl-2 pr-1 font-mono text-[11px] tracking-[0.02em] text-fg-body"
          >
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(t);
              }}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded text-fg-mute hover:bg-white/[0.06] hover:text-fg"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            if (draft) {
              add(draft);
              setDraft("");
            }
          }}
          placeholder={tags.length === 0 ? "Add a tag…" : ""}
          className="min-w-[120px] flex-1 bg-transparent px-1 text-[13px] leading-[22px] text-fg outline-none placeholder:text-fg-faint"
        />
      </div>
      {available.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className={clsx(
                "inline-flex h-[22px] items-center rounded border border-line bg-transparent px-2 font-mono text-[11px]",
                "tracking-[0.02em] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
