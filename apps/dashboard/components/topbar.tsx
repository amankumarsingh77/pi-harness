import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { DashboardSummary } from "@pi-harness/shared";
import { clsx } from "clsx";
import { TopbarNav } from "./topbar-nav";
import { TopbarShortcuts } from "./topbar-live";

export function Topbar({
  summary,
  runningCount,
  blockedCount = 0,
  doneTodayCount: _doneTodayCount = 0,
  branch = "main",
  activeRunsCount,
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

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
      <TopbarShortcuts />
      <div className="flex h-11 items-center px-4 sm:px-5">
        <Link
          href="/"
          className="group inline-flex shrink-0 items-center gap-2 pr-3 text-[13px] font-semibold tracking-tight text-fg"
        >
          <span
            aria-hidden="true"
            className="inline-block h-[7px] w-[7px] rotate-45 bg-fg transition-transform duration-300 group-hover:rotate-[135deg]"
          />
          pi-harness
        </Link>

        <Divider />

        <button
          type="button"
          className="hidden h-7 shrink-0 items-center gap-1 rounded px-2 text-[12px] text-fg-mute transition-colors hover:bg-white/[0.04] hover:text-fg-body sm:inline-flex"
          aria-label={`Workspace branch: ${branch}`}
        >
          <span className="font-mono text-fg-body">{branch}</span>
          <Chevron />
        </button>

        <Divider />

        <Suspense fallback={<NavFallback />}>
          <TopbarNav />
        </Suspense>

        <div
          data-testid="topbar-telemetry-strip"
          className="ml-auto hidden items-center md:flex"
        >
          <TelemetryCell kind="running">
            <Dot
              testId="running-dot"
              color="var(--color-st-progress)"
              muted={running === 0}
              className={running > 0 ? "tick-anim shadow-[0_0_6px_rgba(94,106,210,0.55)]" : ""}
            />
            <Label muted={running === 0}>running</Label>
            <span className="tabular-nums text-fg-body">{running}</span>
          </TelemetryCell>
          <TelemetryCell kind="review">
            <Dot color="var(--color-st-review)" muted={review === 0} />
            <Label muted={review === 0}>review</Label>
            <span
              data-testid="review-value"
              className={clsx("tabular-nums", review > 0 ? "text-st-review" : "text-fg-body")}
            >
              {review}
            </span>
          </TelemetryCell>
          <TelemetryCell kind="blocked" last>
            <Dot color="var(--color-st-blocked)" muted={blocked === 0} />
            <Label muted={blocked === 0}>blocked</Label>
            <span
              data-testid="blocked-value"
              className={clsx("tabular-nums", blocked > 0 ? "text-st-blocked" : "text-fg-body")}
            >
              {blocked}
            </span>
          </TelemetryCell>
        </div>

        <Divider className="ml-3" />

        <button
          type="button"
          aria-label="Open command palette"
          className="hidden h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-fg-mute transition-colors hover:bg-white/[0.04] hover:text-fg-body sm:inline-flex"
        >
          <SearchGlyph />
          <span className="flex items-center gap-0.5 font-mono text-[10.5px] text-fg-faint">
            <kbd className="inline-flex h-[15px] items-center rounded-[3px] border border-line px-1 leading-none">⌘</kbd>
            <kbd className="inline-flex h-[15px] items-center rounded-[3px] border border-line px-1 leading-none">K</kbd>
          </span>
        </button>

        <Link
          href={"/tasks/new" as Route}
          className="ml-2 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-fg px-2.5 text-[12px] font-medium text-bg transition-[background,transform] hover:bg-white active:translate-y-px"
        >
          <PlusGlyph />
          <span>New task</span>
          <kbd className="ml-0.5 hidden h-[15px] items-center rounded-[3px] bg-black/15 px-1 font-mono text-[10px] text-bg/70 sm:inline-flex">N</kbd>
        </Link>

        <button
          type="button"
          aria-label="Account menu"
          className="ml-2 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-fg-body ring-1 ring-line transition-colors hover:bg-white/[0.04] hover:ring-line-hover sm:inline-flex"
        >
          ak
        </button>
      </div>
    </header>
  );
}

function Divider({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx("mx-2 hidden h-4 w-px bg-line sm:inline-block", className)}
    />
  );
}

function TelemetryCell({
  kind,
  last = false,
  children,
}: {
  kind: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      data-kind={kind}
      data-testid="topbar-telemetry-cell"
      className={clsx(
        "inline-flex h-7 items-center gap-1.5 px-2 text-[11.5px] text-fg-body",
        !last && "border-r border-line",
      )}
    >
      {children}
    </span>
  );
}

function Label({ muted, children }: { muted: boolean; children: ReactNode }) {
  return (
    <span className={clsx("text-[11px]", muted ? "text-fg-faint" : "text-fg-mute")}>
      {children}{" "}
    </span>
  );
}

function Dot({
  color,
  className,
  testId,
  muted = false,
}: {
  color: string;
  className?: string;
  testId?: string;
  muted?: boolean;
}) {
  return (
    <span
      data-testid={testId}
      className={clsx("h-1.5 w-1.5 rounded-full transition-opacity", muted && "opacity-40", className)}
      style={{ background: color }}
    />
  );
}

function Chevron() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 9 9"
      fill="none"
      aria-hidden="true"
      className="text-fg-faint"
    >
      <path d="M2 3.5 L4.5 6 L7 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="5" cy="5" r="3.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.6 7.6 L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M5 1.5 V8.5 M1.5 5 H8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function NavFallback() {
  return (
    <nav className="hidden items-center gap-0.5 sm:flex" aria-hidden="true">
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Board</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Runs</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Knowledge</span>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">Chat</span>
    </nav>
  );
}
