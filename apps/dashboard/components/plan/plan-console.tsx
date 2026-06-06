"use client";

import Link from "next/link";
import type { AgentEvent, Artifact, PreflightStep, Run, Task } from "@pi-harness/shared";
import type { PlanGate, PlanJsonlEvent } from "@/lib/api";
import { StatusIcon } from "@/components/kanban/status-icon";
import { CancelPhaseRunButton } from "@/components/task-detail/cancel-phase-run-button";
import { Alert } from "@/components/ui/alert";
import { PreflightAgentConsole } from "./preflight-agent-console";
import { PlanArtifactConsole } from "./plan-artifact-console";
import { PlannerLogPanel } from "./planner-log-panel";
import { RestartPlanButton } from "./restart-plan-button";

export function PlanConsole({
  task,
  runs,
  gate,
  headerStatus,
  iconKind,
  canCancelRun,
  plan,
  phasePlans,
  blastRadius,
  scenarios,
  executionDag,
  research,
  planEvents,
  liveEvents,
  preflightSteps,
  connected,
  plannerLogDefaultOpen,
  lastBlocked,
}: {
  readonly task: Task;
  readonly runs: readonly Run[];
  readonly gate: PlanGate;
  readonly headerStatus: string;
  readonly iconKind: "intake" | "progress" | "review" | "done" | "blocked";
  readonly canCancelRun: boolean;
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly blastRadius: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly executionDag: Artifact | null;
  readonly research: Record<string, string | null>;
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly preflightSteps: readonly PreflightStep[];
  readonly connected: boolean;
  readonly plannerLogDefaultOpen: boolean;
  readonly lastBlocked: { reason: string; ts: string } | null;
}) {
  const planRun = [...runs].reverse().find((run) => run.phase === "plan") ?? null;
  const canRestart =
    (task.status === "planning" || task.status === "plan_failed") &&
    (planRun?.status === "running" || planRun?.status === "cancelled");

  return (
    <main className="scroll-hide min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
      <div className="mx-auto w-full max-w-[1280px] pb-28">
        <nav
          className="mb-3.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-mute"
          aria-label="Breadcrumb"
        >
          <Link href="/" className="transition-colors hover:text-fg-body">
            ← Board
          </Link>
          <span className="text-fg-faint">/</span>
          <Link href={`/tasks/${task.id}` as never} className="text-fg-body hover:text-fg">
            {task.id}
          </Link>
          <span className="text-fg-faint">/</span>
          <span className="text-st-review">plan</span>
        </nav>

        <section className="mb-3 grid grid-cols-1 items-start gap-4 rounded-[10px] border border-line bg-card px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
              <StatusIcon kind={iconKind} size={14} live={iconKind === "progress"} />
              plan phase
            </div>
            <h1 className="m-0 mt-2 text-[20px] font-semibold leading-[1.18] tracking-[-0.02em] text-fg md:text-[22px]">
              {task.title}
            </h1>
            <p className="m-0 mt-2 text-[13px] text-fg-mute">
              Preflight agents validate the implementation path before the planner marks artifacts ready.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <MetaPill label="status" value={headerStatus} />
              <MetaPill label="gate" value={gate} />
              <MetaPill label="branch" value={task.branchName ?? "—"} />
              <MetaPill label="cost" value={planRun ? `$${planRun.costUsd.toFixed(3)}` : "—"} />
              <MetaPill label="stream" value={connected ? "live" : "replay"} />
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {canCancelRun && (
                <CancelPhaseRunButton taskId={task.id} phase="plan" disabled={false} />
              )}
              <RestartPlanButton taskId={task.id} disabled={!canRestart} />
            </div>
          </div>
        </section>

        {lastBlocked && (
          <section
            role="alert"
            aria-label="Plan phase blocked"
            data-testid="plan-blocked-banner"
            className="mb-3 flex items-start gap-3 rounded-[10px] border border-st-blocked/40 bg-st-blocked/[0.07] px-4 py-3"
          >
            <StatusIcon kind="blocked" size={14} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-st-blocked">
                plan blocked
                <span className="text-fg-mute">·</span>
                <time className="text-fg-mute" dateTime={lastBlocked.ts}>
                  {formatBlockedTs(lastBlocked.ts)}
                </time>
              </div>
              <p className="m-0 mt-1 break-words font-mono text-[12.5px] text-fg-body">
                {lastBlocked.reason || "no reason recorded"}
              </p>
            </div>
          </section>
        )}

        {task.status === "plan_failed" && (
          <div className="mb-3">
            <Alert
              tone="danger"
              title="Plan failed"
              label="Plan recovery"
              action={<RestartPlanButton taskId={task.id} disabled={!canRestart} />}
            >
              <p className="m-0 break-words font-mono text-[12.5px]">
                {lastBlocked?.reason || "No failure reason was recorded."}
              </p>
            </Alert>
          </div>
        )}

        <PreflightAgentConsole
          taskId={task.id}
          canCancelRun={canCancelRun}
          research={research}
          planEvents={planEvents}
          liveEvents={liveEvents}
          preflightSteps={preflightSteps}
        />

        <PlanArtifactConsole
          plan={plan}
          phasePlans={phasePlans}
          blastRadius={blastRadius}
          scenarios={scenarios}
          executionDag={executionDag}
        />

        <PlannerLogPanel defaultOpen={plannerLogDefaultOpen} />
      </div>
    </main>
  );
}

function formatBlockedTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetaPill({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <span className="inline-flex min-h-[27px] max-w-full items-center gap-1.5 rounded-full border border-line bg-white/[0.02] px-2.5 font-mono text-[11px] text-fg-mute">
      {label} <strong className="truncate font-medium text-fg-body">{value}</strong>
    </span>
  );
}
