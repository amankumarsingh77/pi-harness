"use client";

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

export type ModelEntry = {
  readonly id: string;
  readonly name: string;
  readonly contextWindow?: string;
  readonly costIn?: string;
  readonly costOut?: string;
  readonly reasoning?: boolean;
};

export type ProviderEntry = {
  readonly id: string;
  readonly name: string;
  readonly authenticated: boolean;
  readonly models: readonly ModelEntry[];
};

type Props = {
  readonly providers: readonly ProviderEntry[];
  readonly selected: { readonly provider: string; readonly model: string };
  readonly onSelect: (provider: string, model: string) => void;
  /** When true the menu opens upward (used inside the bottom composer). */
  readonly openUp?: boolean;
};

/** Short label for the in-composer trigger — model id only, provider lives in the menu. */
function shortModelLabel(providers: readonly ProviderEntry[], selected: { provider: string; model: string }): string {
  const prov = providers.find((p) => p.id === selected.provider);
  const model = prov?.models.find((m) => m.id === selected.model);
  return model?.name ?? selected.model;
}

/**
 * Provider-grouped, searchable model picker.
 * Pattern: priority-picker.tsx — mousedown click-away, Escape, aria-haspopup=listbox.
 * Model list is props-driven (no fetching here). (REQ-040/041/044)
 */
export function ModelPicker({ providers, selected, onSelect, openUp = false }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const q = query.toLowerCase();

  // Derive trigger label
  const triggerLabel = `${selected.provider}/${selected.model}`;

  return (
    <div ref={rootRef} className="relative" data-testid="model-picker">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex h-[26px] max-w-[200px] items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors",
          open
            ? "bg-[var(--color-card-hover)] text-[var(--color-fg)]"
            : "text-[var(--color-fg-mute)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg-body)]",
        )}
      >
        <svg className="h-[13px] w-[13px] flex-none text-[var(--color-fg-faint)]" viewBox="0 0 13 13" fill="none" aria-hidden>
          <path d="M6.5 1.5l4.3 2.5v5L6.5 11.5 2.2 9V4z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
        <span className="truncate">{shortModelLabel(providers, selected)}</span>
        <svg className="h-[9px] w-[9px] flex-none text-[var(--color-fg-faint)]" viewBox="0 0 9 9" fill="none" aria-hidden>
          <path d="M2 3.5L4.5 6L7 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Model"
          className={clsx(
            "absolute left-0 z-50 w-[320px] overflow-hidden rounded-[11px] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[0_12px_32px_rgba(0,0,0,0.55),0_0_0_1px_rgba(0,0,0,0.3)]",
            openUp ? "bottom-[calc(100%+7px)]" : "top-[calc(100%+7px)]",
          )}
        >
          {/* search */}
          <div className="flex items-center gap-[7px] border-b border-[var(--color-line)] px-[11px] py-[9px] text-[12px] text-[var(--color-fg-faint)]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="5" cy="5" r="3.3" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7.6 7.6L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search models"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border-none bg-transparent outline-none text-[var(--color-fg-body)] placeholder:text-[var(--color-fg-faint)]"
            />
          </div>

          {/* provider groups */}
          <div className="no-scrollbar max-h-[360px] overflow-y-auto p-[5px]">
            {providers.map((prov) => {
              const visibleModels = prov.models.filter((m) => {
                if (!q) return true;
                return (
                  m.name.toLowerCase().includes(q) ||
                  m.id.toLowerCase().includes(q) ||
                  prov.name.toLowerCase().includes(q) ||
                  prov.id.toLowerCase().includes(q)
                );
              });

              if (visibleModels.length === 0) return null;

              return (
                <div key={prov.id}>
                  {/* group header */}
                  <div className="flex items-center gap-[7px] px-2 pb-[5px] pt-[9px] font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--color-fg-faint)]">
                    <svg className="h-[13px] w-[13px] text-[var(--color-fg-mute)]" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                      <path d="M6.5 1.5l4.3 2.5v5L6.5 11.5 2.2 9V4z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                    </svg>
                    {prov.name}
                    {prov.authenticated ? (
                      <span
                        data-testid={`auth-ok-${prov.id}`}
                        className="ml-auto normal-case tracking-normal text-[10px] text-[var(--color-st-done)]"
                      >
                        ● connected
                      </span>
                    ) : (
                      <span
                        data-testid={`auth-off-${prov.id}`}
                        className="ml-auto normal-case tracking-normal text-[10px] text-[var(--color-fg-faint)]"
                      >
                        ○ sign in
                      </span>
                    )}
                  </div>

                  {/* models */}
                  {visibleModels.map((m) => {
                    const isSel = selected.provider === prov.id && selected.model === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onClick={() => {
                          onSelect(prov.id, m.id);
                          setQuery("");
                          setOpen(false);
                        }}
                        className={clsx(
                          "flex w-full items-center gap-2.5 rounded-[7px] px-[9px] py-2 text-left transition-colors",
                          isSel ? "bg-[var(--color-sub)]" : "hover:bg-[var(--color-card-hover)]",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={clsx("flex items-center gap-[7px] text-[12.5px]", isSel ? "text-[var(--color-fg)]" : "text-[var(--color-fg-body)]")}>
                            {m.name}
                            {m.reasoning && (
                              <span className="rounded border border-[rgba(192,132,252,0.3)] px-1.5 py-px text-[9.5px] leading-none text-[var(--color-st-shipping)]">
                                reasoning
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-fg-faint)]">
                            {prov.id}/{m.id}
                          </span>
                          {(m.contextWindow || m.costIn) && (
                            <span className="mt-1 flex gap-2 text-[10px] text-[var(--color-fg-faint)]">
                              {m.contextWindow && (
                                <span>
                                  <b className="text-[var(--color-fg-mute)] font-medium">{m.contextWindow}</b> ctx
                                </span>
                              )}
                              {m.costIn && m.costOut && (
                                <span>
                                  <b className="text-[var(--color-fg-mute)] font-medium">{m.costIn}</b>/
                                  <b className="text-[var(--color-fg-mute)] font-medium">{m.costOut}</b> per M
                                </span>
                              )}
                            </span>
                          )}
                        </span>

                        {/* check mark */}
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
              );
            })}
          </div>

          {/* footer */}
          <div className="flex items-center gap-1.5 border-t border-[var(--color-line)] px-[11px] py-2 text-[10.5px] text-[var(--color-fg-faint)]">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
              <path d="M5.5 1.5l3 1.7v3.6l-3 1.7-3-1.7V3.2z" stroke="currentColor" strokeWidth="1" />
            </svg>
            Keys &amp; providers configured in{" "}
            <span className="text-[var(--color-fg-mute)]">.env.harness</span>
          </div>
        </div>
      )}
    </div>
  );
}
