import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { clsx } from "clsx";
import { TopbarNav } from "./topbar-nav";

export function Topbar({
  runningCount,
  blockedCount = 0,
  doneTodayCount = 0,
  branch = "main",
  // Legacy props — accepted for back-compat with non-board callers.
  // Mapped to runningCount when runningCount is not provided.
  activeRunsCount,
  // Ignored under the new design.
  pathLabel: _pathLabel,
  worktreesCount: _worktreesCount,
  worktreesSizeMb: _worktreesSizeMb,
}: {
  runningCount?: number;
  blockedCount?: number;
  doneTodayCount?: number;
  branch?: string;
  activeRunsCount?: number;
  pathLabel?: string;
  worktreesCount?: number;
  worktreesSizeMb?: number;
}) {
  const running = runningCount ?? activeRunsCount ?? 0;
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-6 border-b border-line bg-bg/85 px-5 backdrop-blur-sm">
      <div className="flex items-center gap-6">
        <Link href="/" className="inline-flex items-center gap-2 text-[13.5px] font-semibold tracking-tight text-fg">
          <span
            className="h-4 w-4 rounded shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
            style={{ background: "linear-gradient(135deg, var(--color-st-progress) 0%, var(--color-st-shipping) 100%)" }}
            aria-hidden="true"
          />
          pi-harness
        </Link>
        <Suspense fallback={<NavFallback />}>
          <TopbarNav />
        </Suspense>
      </div>

      <div className="ml-auto flex items-center gap-[18px] font-mono text-[11px] tracking-[0.02em] text-fg-mute">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              running > 0 ? "tick-anim shadow-[0_0_6px_rgba(94,106,210,0.5)]" : "",
            )}
            style={{ background: "var(--color-st-progress)" }}
          />
          {running} running
        </span>
        <span className={clsx("inline-flex items-center gap-1.5", blockedCount > 0 ? "text-st-blocked" : "text-fg-mute")}>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: blockedCount > 0 ? "var(--color-st-blocked)" : "var(--color-fg-faint)" }}
          />
          {blockedCount} blocked
        </span>
        <span className="text-fg-faint">{doneTodayCount} done today</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded border border-line bg-card px-2.5 py-1 font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body"
        >
          <kbd className="inline-flex items-center rounded border border-line bg-white/[0.02] px-1 py-px text-[10.5px] text-fg-faint">⌘</kbd>
          <kbd className="inline-flex items-center rounded border border-line bg-white/[0.02] px-1 py-px text-[10.5px] text-fg-faint">K</kbd>
          <span className="ml-1">Search</span>
        </button>
        <Link
          href={"/tasks/new" as Route}
          className="rounded bg-st-progress px-3 py-1.5 text-[12px] font-medium text-white transition-[filter] hover:brightness-110"
        >
          + New task
        </Link>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body"
        >
          {branch}
          <span className="text-fg-faint">▾</span>
        </button>
      </div>
    </header>
  );
}

function NavFallback() {
  return (
    <nav className="flex items-center gap-0.5" aria-hidden="true">
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Board</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Runs</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Scenarios</span>
    </nav>
  );
}
