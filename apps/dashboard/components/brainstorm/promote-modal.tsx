"use client";

import { useTransition } from "react";
import type { TokenDiff } from "@/lib/api";

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/;

function isColor(v: string | null): v is string {
  return v !== null && COLOR_RE.test(v.trim());
}

function ValueChip({ value }: { value: string | null }) {
  if (value === null) {
    return <span className="font-mono text-[11px] text-fg-faint">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {isColor(value) && (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 shrink-0 rounded-[2px] ring-1 ring-line"
          style={{ background: value }}
        />
      )}
      <span className="font-mono text-[11px] text-fg-body">{value}</span>
    </span>
  );
}

export function PromoteModal({
  diff,
  onConfirm,
  onClose,
}: {
  diff: TokenDiff;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Promote mock to design system"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-baseline gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[13px] font-semibold text-fg">Promote to design system</h2>
          <span className="font-mono text-[11px] text-fg-mute">
            tokens v{diff.fromVersion} → v{diff.toVersion}
          </span>
          <span className="ml-auto font-mono text-[11px] text-fg-faint">
            {diff.changes.length} token{diff.changes.length === 1 ? "" : "s"}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <p className="text-[12px] text-fg-body">{diff.summary}</p>

          <div className="mt-3 overflow-hidden rounded border border-line">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-bg font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-mute">
                  <th className="px-3 py-1.5 font-medium">token</th>
                  <th className="px-3 py-1.5 font-medium">before</th>
                  <th className="px-3 py-1.5 font-medium">after</th>
                </tr>
              </thead>
              <tbody>
                {diff.changes.map((c) => (
                  <tr key={c.name} className="border-b border-line last:border-0">
                    <td className="px-3 py-1.5 align-top font-mono text-[11px] text-fg">
                      {c.name}
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      <ValueChip value={c.before} />
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      <ValueChip value={c.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {diff.designMdDelta.trim().length > 0 && (
            <pre className="mt-3 max-h-40 overflow-auto rounded border border-line bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-body">
              {diff.designMdDelta}
            </pre>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3">
          <span className="mr-auto text-[11px] text-fg-mute">
            Confirm writes these tokens to the shared design system for all tasks.
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded border border-line px-2.5 py-1 font-mono text-[11px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              start(async () => {
                await onConfirm();
                onClose();
              });
            }}
            className="rounded bg-st-progress px-3 py-1 font-mono text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint"
          >
            {pending ? "Promoting…" : `Confirm v${diff.toVersion}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
