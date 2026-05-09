import { clsx } from "clsx";
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

export function RunRow({ run }: { run: MockRun }) {
  const kind = statusKindForRun(run);
  const live = run.outcome.kind === "running";
  const isRetry = run.attempt > 1;

  return (
    <div
      className="grid h-10 cursor-pointer items-center gap-4 border-b border-line px-6 text-[12.5px] transition-colors hover:bg-white/[0.025]"
      style={{ gridTemplateColumns: "24px 130px 1fr 200px 90px 170px" }}
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
    </div>
  );
}

export function RunTableHeader({ outcomeLabel }: { outcomeLabel: string }) {
  return (
    <div
      className="grid h-7 items-center gap-4 border-t border-b border-line px-6 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle"
      style={{ gridTemplateColumns: "24px 130px 1fr 200px 90px 170px" }}
    >
      <span />
      <span>Run</span>
      <span>Task</span>
      <span>{outcomeLabel}</span>
      <span className="text-right">Duration</span>
      <span>Branch</span>
    </div>
  );
}
