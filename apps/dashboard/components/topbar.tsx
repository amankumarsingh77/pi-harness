import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { DashboardSummary } from "@pi-harness/shared";
import { clsx } from "clsx";
import { TopbarNav } from "./topbar-nav";
import { LastEventTelemetry, TopbarShortcuts } from "./topbar-live";

export function Topbar({
  summary,
  runningCount,
  blockedCount = 0,
  doneTodayCount: _doneTodayCount = 0,
  branch = "main",
  // Legacy props — accepted for back-compat with non-board callers.
  // Mapped to runningCount when runningCount is not provided.
  activeRunsCount,
  // Ignored under the new design.
  pathLabel: _pathLabel,
  worktreesCount: _worktreesCount,
  worktreesSizeMb: _worktreesSizeMb,
}: {
  summary?: DashboardSummary;
  runningCount?: number;
  blockedCount?: number;
  doneTodayCount?: number;
  branch?: string;
  activeRunsCount?: number;
  pathLabel?: string;
  worktreesCount?: number;
  worktreesSizeMb?: number;
}) {
  const running = summary?.runningCount ?? runningCount ?? activeRunsCount ?? 0;
  const review = summary?.reviewCount ?? 0;
  const blocked = summary?.blockedCount ?? blockedCount;
  const costUsd = summary?.costUsd ?? 0;
  const costCapUsd = summary?.costCapUsd ?? 10;
  const activeRunIds = summary?.activeRunIds ?? [];
  const lastEventAt = summary?.lastEventAt ?? null;
  const visibleWorktreesCount = _worktreesCount ?? activeRunIds.length;

  return (
    <header className="sticky top-0 z-20 flex h-[48px] items-center gap-4 border-b border-line bg-bg/85 px-4 backdrop-blur-sm sm:px-5">
      <TopbarShortcuts />
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <Link href="/" className="inline-flex shrink-0 items-center gap-2 text-[13.5px] font-semibold tracking-tight text-fg">
          <span
            className="h-4 w-4 rounded border border-line bg-card"
            aria-hidden="true"
          />
          pi-harness
        </Link>
        <span className="hidden h-6 shrink-0 items-center rounded border border-line px-2 font-mono text-[11px] text-fg-mute sm:inline-flex">
          ws&nbsp;<span className="text-fg-body">{branch}</span>
        </span>
        <Suspense fallback={<NavFallback />}>
          <TopbarNav worktreesCount={visibleWorktreesCount} />
        </Suspense>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div
          data-testid="topbar-telemetry-strip"
          className="hidden overflow-hidden rounded-md border border-line font-mono text-[11px] text-fg-mute md:inline-flex"
        >
          <TelemetryCell kind="running">
            <Dot
              testId="running-dot"
              color="var(--color-st-progress)"
              className={running > 0 ? "tick-anim shadow-[0_0_6px_rgba(94,106,210,0.5)]" : ""}
            />
            <span>running </span>
            <span className="text-fg-body">{running}</span>
          </TelemetryCell>
          <TelemetryCell kind="review">
            <Dot color="var(--color-st-review)" />
            <span>review </span>
            <span data-testid="review-value" className={clsx(review > 0 ? "text-st-review" : "text-fg-body")}>
              {review}
            </span>
          </TelemetryCell>
          <TelemetryCell kind="blocked">
            <Dot color="var(--color-st-blocked)" />
            <span>blocked </span>
            <span data-testid="blocked-value" className={clsx(blocked > 0 ? "text-st-blocked" : "text-fg-body")}>
              {blocked}
            </span>
          </TelemetryCell>
          <TelemetryCell kind="cost">
            <span>cost </span>
            <span className="tabular-nums text-fg-body">
              {formatCost(costUsd)} / {formatCost(costCapUsd)}
            </span>
          </TelemetryCell>
          <TelemetryCell kind="last">
            <LastEventTelemetry initialLastEventAt={lastEventAt} activeRunIds={activeRunIds} />
          </TelemetryCell>
        </div>
        <button
          type="button"
          className="hidden h-7 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body sm:inline-flex"
        >
          <kbd className="inline-flex items-center rounded border border-line bg-white/[0.02] px-1 py-px text-[10.5px] text-fg-faint">⌘</kbd>
          <kbd className="inline-flex items-center rounded border border-line bg-white/[0.02] px-1 py-px text-[10.5px] text-fg-faint">K</kbd>
          <span className="ml-1 hidden sm:inline">Search · go to · run</span>
        </button>
        <Link
          href={"/tasks/new" as Route}
          className="inline-flex h-7 items-center rounded-md bg-st-progress px-3 text-[12px] font-medium text-white transition-[filter] hover:brightness-110"
        >
          + New task
        </Link>
        <span className="hidden h-7 w-7 items-center justify-center rounded-full border border-line bg-card font-mono text-[11px] text-fg-mute sm:inline-flex">
          ak
        </span>
      </div>
    </header>
  );
}

function TelemetryCell({
  kind,
  children,
}: {
  kind: string;
  children: ReactNode;
}) {
  return (
    <span
      data-kind={kind}
      data-testid="topbar-telemetry-cell"
      className="inline-flex h-7 items-center gap-1.5 border-r border-line px-2.5 last:border-r-0"
    >
      {children}
    </span>
  );
}

function Dot({
  color,
  className,
  testId,
}: {
  color: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={clsx("h-1.5 w-1.5 rounded-full", className)}
      style={{ background: color }}
    />
  );
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function NavFallback() {
  return (
    <nav className="hidden items-center gap-0.5 sm:flex" aria-hidden="true">
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Board</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Runs</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Scenarios</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Worktrees 0</span>
    </nav>
  );
}
