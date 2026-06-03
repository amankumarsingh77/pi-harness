import { clsx } from "clsx";
import { ChevronDown } from "lucide-react";
import { StatusIcon } from "@/components/kanban/status-icon";
import type { MockRun } from "@/types/mocks";
import { statusKindForRun } from "@/lib/run-status";

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function outcomeText(run: MockRun): string {
  const o = run.outcome;
  switch (o.kind) {
    case "running":
      return `${o.phase} · running`;
    case "blocked":
      return `${o.phase} · blocked`;
    case "review":
      return `${o.phase} · awaiting review`;
    case "shipping":
      return `${o.phase} · #${o.pr}`;
    case "merged":
      return `merged · #${o.pr}`;
    case "failed":
      return `${o.phase} · failed`;
    case "abandoned":
      return `${o.phase} · abandoned`;
  }
}

function outcomeToneClass(run: MockRun): string {
  switch (run.outcome.kind) {
    case "running":
      return "text-st-progress";
    case "blocked":
    case "failed":
    case "abandoned":
      return "text-st-blocked";
    case "review":
      return "text-st-review";
    case "shipping":
      return "text-st-shipping";
    case "merged":
      return "text-st-done";
  }
}

export function RunRow({
  run,
  expanded = false,
  onToggle,
}: {
  readonly run: MockRun;
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
}) {
  const kind = statusKindForRun(run);
  const live = run.outcome.kind === "running";
  const isRetry = run.attempt > 1;

  return (
    <div className="border-b border-line">
      <button
        type="button"
        aria-expanded={expanded}
        className={clsx(
          "grid h-10 w-full items-center gap-4 px-6 text-left text-[12.5px] transition-colors",
          "hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:outline-none",
          expanded && "bg-white/[0.025]",
        )}
        style={{ gridTemplateColumns: "24px 130px 1fr 200px 90px 170px 18px" }}
        onClick={onToggle}
      >
        <span className="inline-flex">
          <StatusIcon kind={kind} live={live} />
        </span>
        <span className="inline-flex items-baseline gap-2 overflow-hidden">
          <span className="font-mono text-[11.5px] text-fg">{run.id}</span>
          <span
            className={clsx(
              "rounded border px-1 font-mono text-[10.5px] leading-[1.4]",
              isRetry
                ? "border-[rgba(242,201,76,0.25)] text-st-review"
                : "border-line text-fg-subtle",
            )}
          >
            r{run.attempt}
          </span>
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-fg-body tracking-[-0.005em]">
          <span className="mr-2 font-mono text-[11px] text-fg-subtle">{run.taskId}</span>
          {run.taskTitle}
        </span>
        <span
          className={clsx(
            "overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] lowercase",
            outcomeToneClass(run),
          )}
        >
          {outcomeText(run)}
        </span>
        <span className="text-right font-mono text-[11.5px] text-fg-mute">
          {formatDuration(run.durationMs)}
        </span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-fg-mute">
          {run.branch}
        </span>
        <span className="text-fg-faint">
          <ExpandIndicator expanded={expanded} />
        </span>
      </button>
      {expanded && <RunDetail run={run} />}
    </div>
  );
}

function RunDetail({ run }: { readonly run: MockRun }) {
  return (
    <div className="grid gap-3 bg-white/[0.018] px-6 py-3 text-[12px] sm:grid-cols-4">
      <DetailItem label="Started" value={formatStarted(run.startedAt)} />
      <DetailItem label="Duration" value={formatDuration(run.durationMs)} />
      <DetailItem label="Branch" value={run.branch} />
      <DetailItem label="Inspect" value={outcomeText(run)} tone={outcomeToneClass(run)} />
    </div>
  );
}

function DetailItem({
  label,
  value,
  tone = "text-fg-body",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-card px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-faint">{label}</div>
      <div className={clsx("mt-1 truncate font-mono text-[11.5px]", tone)}>{value}</div>
    </div>
  );
}

function formatStarted(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ExpandIndicator({ expanded }: { readonly expanded: boolean }) {
  return (
    <ChevronDown
      size={14}
      strokeWidth={1.9}
      aria-hidden="true"
      className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
    />
  );
}

export function RunTableHeader({ outcomeLabel }: { outcomeLabel: string }) {
  return (
    <div
      className="grid h-7 items-center gap-4 border-t border-b border-line px-6 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle"
      style={{ gridTemplateColumns: "24px 130px 1fr 200px 90px 170px 18px" }}
    >
      <span />
      <span>Run</span>
      <span>Task</span>
      <span>{outcomeLabel}</span>
      <span className="text-right">Duration</span>
      <span>Branch</span>
      <span />
    </div>
  );
}
