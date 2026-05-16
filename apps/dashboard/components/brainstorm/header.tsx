"use client";

import Link from "next/link";
import type { Task } from "@pi-harness/shared";
import { mergePhaseModels } from "@pi-harness/shared";
import { RestartButton } from "./restart-button";
import { StatusIcon, type StatusKind } from "@/components/kanban/status-icon";
import { CancelPhaseRunButton } from "@/components/task-detail/cancel-phase-run-button";
import type { ActivityState } from "./activity-line";
import type { BrainstormHealth, UsageSummary } from "./use-brainstorm-timeline";

export function BrainstormHeader({
  task,
  usage,
  activity,
  activityStartedAtMs,
  nowMs,
  health,
  pastBrainstorm,
  failed,
  canCancel,
  cancelled,
}: {
  readonly task: Task;
  readonly usage: UsageSummary;
  readonly activity: ActivityState;
  readonly activityStartedAtMs: number | null;
  readonly nowMs: number;
  readonly health: BrainstormHealth;
  readonly pastBrainstorm: boolean;
  readonly failed: boolean;
  readonly canCancel: boolean;
  readonly cancelled: boolean;
}) {
  const phaseModel = mergePhaseModels(task.phaseModels, "brainstorm");
  const status = headerStatus({ task, pastBrainstorm, failed, cancelled, health });
  const restartEnabled = task.status === "brainstorming" || task.status === "brainstorm_failed";

  return (
    <section className="brainstorm-page-header">
      <nav className="brainstorm-crumbs" aria-label="Breadcrumb">
        <Link href="/" className="text-fg-mute hover:text-fg-body">
          Board
        </Link>
        <span className="text-fg-faint">/</span>
        <Link href={`/tasks/${task.id}` as never} className="text-fg-body hover:text-fg">
          {task.id}
        </Link>
        <span className="text-fg-faint">/</span>
        <span className="text-st-review">brainstorm</span>
      </nav>
      <div className="flex min-w-0 items-center gap-3">
        <StatusIcon kind={status.icon} size={16} />
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-fg">
          {task.title}
        </h1>
        <div className="hidden min-w-0 items-center gap-2 font-mono text-[11px] text-fg-mute lg:flex">
          {task.branchName && <span className="max-w-[180px] truncate">{task.branchName}</span>}
          <span>{phaseModel.model}</span>
          <span>{formatCost(usage.costUsd)}</span>
          <ActivityMeta
            activity={activity}
            activityStartedAtMs={activityStartedAtMs}
            nowMs={nowMs}
            fallback={status.label}
          />
        </div>
        {canCancel && (
          <CancelPhaseRunButton taskId={task.id} phase="brainstorm" disabled={false} />
        )}
        <RestartButton taskId={task.id} disabled={!restartEnabled} />
      </div>
    </section>
  );
}

function ActivityMeta({
  activity,
  activityStartedAtMs,
  nowMs,
  fallback,
}: {
  readonly activity: ActivityState;
  readonly activityStartedAtMs: number | null;
  readonly nowMs: number;
  readonly fallback: string;
}) {
  if (activity === null) {
    return <span className="text-fg-subtle">{fallback}</span>;
  }
  const label = activity.kind === "thinking" ? "thinking" : activity.tool;
  const elapsed =
    activityStartedAtMs === null ? null : Math.max(0, Math.floor((nowMs - activityStartedAtMs) / 1000));
  return (
    <span className="inline-flex items-center gap-1 text-st-progress">
      <span className="pulse-dot" aria-hidden="true" />
      {label}
      {elapsed !== null && <span className="text-fg-subtle">· {elapsed}s</span>}
    </span>
  );
}

function headerStatus({
  task,
  pastBrainstorm,
  failed,
  cancelled,
  health,
}: {
  readonly task: Task;
  readonly pastBrainstorm: boolean;
  readonly failed: boolean;
  readonly cancelled: boolean;
  readonly health: BrainstormHealth;
}): { readonly icon: StatusKind; readonly label: string } {
  if (pastBrainstorm) return { icon: "done", label: "approved" };
  if (failed) return { icon: "blocked", label: "failed" };
  if (cancelled) return { icon: "blocked", label: "cancelled — restart to retry" };
  if (task.status === "backlog") return { icon: "intake", label: "not started" };
  if (health === "reconnecting") return { icon: "review", label: "reconnecting" };
  return { icon: "progress", label: "in progress" };
}

function formatCost(cost: number): string {
  return cost > 0 ? `$${cost.toFixed(4)}` : "$0.0000";
}
