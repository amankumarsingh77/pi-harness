import Link from "next/link";
import type { Route } from "next";
import { StatusIcon, type StatusKind } from "@/components/kanban/status-icon";
import type { CodeMetrics } from "@/lib/code/derive-code-state";

export type CodePhaseStatus = "not started" | "in progress" | "complete" | "failed";

const ICON_KIND: Record<CodePhaseStatus, StatusKind> = {
  "not started": "intake",
  "in progress": "progress",
  complete: "done",
  failed: "blocked",
};

const STATUS_LABEL: Record<CodePhaseStatus, string> = {
  "not started": "not started",
  "in progress": "in progress",
  complete: "complete",
  failed: "failed",
};

const STATUS_COLOR: Record<CodePhaseStatus, string> = {
  "not started": "text-fg-mute",
  "in progress": "text-st-progress",
  complete: "text-st-done",
  failed: "text-st-blocked",
};

export function CodeHeader({
  taskId,
  phaseStatus,
  metrics,
}: {
  readonly taskId: string;
  readonly phaseStatus: CodePhaseStatus;
  readonly metrics: CodeMetrics;
}) {
  const live = phaseStatus === "in progress";
  return (
    <header className="flex items-center gap-3.5 border-b border-line px-[22px] py-3.5">
      <div>
        <nav className="flex items-center font-mono text-[12px] text-fg-mute" aria-label="Breadcrumb">
          <Link href={`/tasks/${taskId}` as Route} className="hover:text-fg-body">
            {taskId}
          </Link>
          <Sep />
          <Link href={`/tasks/${taskId}/brainstorm` as Route} className="hover:text-fg-body">
            brainstorm
          </Link>
          <Chevron />
          <Link href={`/tasks/${taskId}/plan` as Route} className="hover:text-fg-body">
            plan
          </Link>
          <Chevron />
          <span className="text-fg-body">code</span>
        </nav>
        <div className="mt-1.5 flex items-center gap-2.5">
          <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border border-line-hover">
            <StatusIcon kind={ICON_KIND[phaseStatus]} live={live} size={13} />
          </span>
          <h1 className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-fg">
            Executing code DAG
          </h1>
          <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${STATUS_COLOR[phaseStatus]}`}>
            {live && <span className="pulse-dot" />}
            {STATUS_LABEL[phaseStatus]}
            {metrics.waveTotal > 0 && (
              <span className="text-fg-mute">
                · wave {Math.min(metrics.waveCurrent, metrics.waveTotal)} of {metrics.waveTotal}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center">
        <Metric label="done" value={`${metrics.doneCount}/${metrics.totalCount}`} />
        <Metric label="commits" value={String(metrics.commitCount)} />
        <Metric label="tokens" value={formatTokens(metrics.totalInputTokens + metrics.totalOutputTokens)} />
        <Metric label="cost" value={`$${metrics.totalCostUsd.toFixed(2)}`} accent />
      </div>
    </header>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-l border-line px-4 text-right">
      <span className="text-[10px] text-fg-faint">{label}</span>
      <span
        className={`font-mono text-[13px] tabular-nums ${accent ? "text-st-progress" : "text-fg"}`}
      >
        {value}
      </span>
    </div>
  );
}

function Sep() {
  return <span className="mx-1.5 text-fg-ghost">/</span>;
}

function Chevron() {
  return <span className="mx-1.5 text-fg-ghost">›</span>;
}

function formatTokens(total: number): string {
  if (total >= 1000) return `${Math.round(total / 1000)}k`;
  return String(total);
}
