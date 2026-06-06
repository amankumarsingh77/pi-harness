"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { AgentEvent, Artifact, PreflightStep, Run, Task } from "@pi-harness/shared";
import { approvePlan, requestPlanChanges } from "@/app/tasks/[id]/plan/actions";
import type { PlanGate, PlanJsonlEvent } from "@/lib/api";
import { parseExecutionDag } from "@/lib/code/parse-execution-dag";
import { StatusIcon } from "@/components/kanban/status-icon";
import { CancelPhaseRunButton } from "@/components/task-detail/cancel-phase-run-button";
import { Alert } from "@/components/ui/alert";
import { PreflightAgentConsole } from "./preflight-agent-console";
import { PlanArtifactConsole } from "./plan-artifact-console";
import { PlannerLogPanel } from "./planner-log-panel";
import { SUBAGENTS, deriveKind, type DotKind } from "./preflight-progress";
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
  const preflight = useMemo(
    () => derivePreflightSummary({ research, planEvents, liveEvents, preflightSteps }),
    [research, planEvents, liveEvents, preflightSteps],
  );
  const readiness = useMemo(
    () =>
      buildReadinessItems({
        plan,
        phasePlans,
        scenarios,
        blastRadius,
        executionDag,
        preflight,
        gate,
        lastBlocked,
      }),
    [plan, phasePlans, scenarios, blastRadius, executionDag, preflight, gate, lastBlocked],
  );
  const planRisks = useMemo(
    () =>
      buildPlanRisks({
        plan,
        scenarios,
        blastRadius,
        executionDag,
        preflight,
        gate,
        lastBlocked,
      }),
    [plan, scenarios, blastRadius, executionDag, preflight, gate, lastBlocked],
  );
  const plannerLogOpen = plannerLogDefaultOpen && gate === "running";

  return (
    <main className="scroll-hide min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-5">
      <div className="mx-auto w-full max-w-[1440px] pb-24">
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

        <section
          aria-label="Plan review command center"
          className="mb-3 overflow-hidden rounded-[10px] border border-line bg-card"
        >
          <div className="grid grid-cols-1 gap-4 border-b border-line px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
                <StatusIcon kind={iconKind} size={14} live={iconKind === "progress"} />
                Plan Review
              </div>
              <h1 className="m-0 mt-2 text-[22px] font-semibold leading-[1.14] text-fg md:text-[26px]">
                {task.title}
              </h1>
              <p className="m-0 mt-2 max-w-[760px] text-[13px] leading-5 text-fg-mute">
                Review planner output, preflight evidence, coverage, and execution order before approving code.
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
          </div>
          <div className="grid grid-cols-1 gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_auto]">
            <PlanStageProgress gate={gate} preflight={preflight} readiness={readiness} />
            <InlinePlanApprovalActions taskId={task.id} gate={gate} taskStatus={task.status} />
          </div>
          {lastBlocked && (
            <div className="border-t border-st-blocked/35 bg-st-blocked/[0.055] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <StatusIcon kind="blocked" size={14} />
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-st-blocked">
                    active blocker · {formatBlockedTs(lastBlocked.ts)}
                  </div>
                  <p className="m-0 mt-1 break-words font-mono text-[12.5px] text-fg-body">
                    {lastBlocked.reason || "no reason recorded"}
                  </p>
                </div>
              </div>
            </div>
          )}
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

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
          <section
            aria-label="Agents"
            className="min-w-0 overflow-hidden rounded-[9px] border border-line bg-card/70"
          >
            <header className="border-b border-line px-3 py-3">
              <div className="text-[13px] font-semibold text-fg">Agents</div>
              <div className="mt-1 font-mono text-[10.5px] text-fg-mute">
                preflight roster and planner stream
              </div>
            </header>
            <PreflightAgentConsole
              taskId={task.id}
              canCancelRun={canCancelRun}
              research={research}
              planEvents={planEvents}
              liveEvents={liveEvents}
              preflightSteps={preflightSteps}
            />
            <div className="border-t border-line">
              <PlannerLogPanel defaultOpen={plannerLogOpen} />
            </div>
          </section>

          <PlanArtifactConsole
            plan={plan}
            phasePlans={phasePlans}
            blastRadius={blastRadius}
            scenarios={scenarios}
            executionDag={executionDag}
          />

          <PlanRisksPanel risks={planRisks} />
        </div>

      </div>
    </main>
  );
}

type PreflightSummary = {
  readonly done: number;
  readonly progress: number;
  readonly fallback: number;
  readonly queued: number;
  readonly blocked: number;
};

type ReadinessItem = {
  readonly label: string;
  readonly value: string;
  readonly ready: boolean;
};

type PlanRiskTone = "blocked" | "warn" | "info" | "ok";

type PlanRisk = {
  readonly title: string;
  readonly detail: string;
  readonly tone: PlanRiskTone;
};

function derivePreflightSummary({
  research,
  planEvents,
  liveEvents,
  preflightSteps,
}: {
  readonly research: Record<string, string | null>;
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly preflightSteps: readonly PreflightStep[];
}): PreflightSummary {
  const lifecycleEvents = [...planEvents, ...liveEventsToPlanEvents(liveEvents)];
  const kinds = SUBAGENTS.map((subagent) =>
    deriveKind(subagent, research, lifecycleEvents, preflightSteps),
  );
  return {
    done: kinds.filter((kind) => kind === "done").length,
    progress: kinds.filter((kind) => kind === "progress").length,
    fallback: kinds.filter((kind) => kind === "fallback").length,
    queued: kinds.filter((kind) => kind === "intake").length,
    blocked: kinds.filter((kind) => kind === "blocked").length,
  };
}

function buildReadinessItems({
  plan,
  phasePlans,
  scenarios,
  blastRadius,
  executionDag,
  preflight,
  gate,
  lastBlocked,
}: {
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly scenarios: Artifact | null;
  readonly blastRadius: Artifact | null;
  readonly executionDag: Artifact | null;
  readonly preflight: PreflightSummary;
  readonly gate: PlanGate;
  readonly lastBlocked: { reason: string; ts: string } | null;
}): readonly ReadinessItem[] {
  const scenarioCount = countYamlListItems(scenarios?.body ?? "", "scenarios");
  const blastRadiusCount = countYamlListItems(blastRadius?.body ?? "", "items");
  return [
    readiness("plan.md", plan?.fm.status ?? "missing", isArtifactReady(plan)),
    readiness(
      "phase plans",
      phasePlans.length > 0 ? `${phasePlans.length} ready` : "overview only",
      phasePlans.every(isArtifactReady),
    ),
    readiness("scenarios", scenarioCount > 0 ? `${scenarioCount} scenario${plural(scenarioCount)}` : "missing", isArtifactReady(scenarios)),
    readiness("blast radius", blastRadiusCount > 0 ? `${blastRadiusCount} item${plural(blastRadiusCount)}` : "missing", isArtifactReady(blastRadius)),
    readiness("execution DAG", executionDag?.fm.status ?? "missing", isArtifactReady(executionDag)),
    readiness("preflight", preflight.blocked > 0 ? `${preflight.blocked} blocked` : `${preflight.done + preflight.fallback}/${SUBAGENTS.length} complete`, preflight.blocked === 0 && preflight.progress === 0 && preflight.queued === 0),
    readiness("review gate", gate === "awaiting_user" ? "awaiting approval" : "running", gate === "awaiting_user"),
    readiness("blockers", lastBlocked ? "active" : "none", lastBlocked === null),
  ];
}

function readiness(label: string, value: string, ready: boolean): ReadinessItem {
  return { label, value, ready };
}

function isArtifactReady(artifact: Artifact | null): boolean {
  if (!artifact) return false;
  return artifact.fm.status === "ready" || artifact.fm.status === "human_edited" || artifact.fm.status === "approved";
}

function buildPlanRisks({
  plan,
  scenarios,
  blastRadius,
  executionDag,
  preflight,
  gate,
  lastBlocked,
}: {
  readonly plan: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly blastRadius: Artifact | null;
  readonly executionDag: Artifact | null;
  readonly preflight: PreflightSummary;
  readonly gate: PlanGate;
  readonly lastBlocked: { reason: string; ts: string } | null;
}): readonly PlanRisk[] {
  const dag = parseExecutionDag(executionDag?.body ?? "");
  const missingAssertions = dag.nodes.filter((node) => node.assertion === null).length;
  const risks: PlanRisk[] = [
    ...(lastBlocked
      ? [risk("Active blocker", lastBlocked.reason || "No reason recorded.", "blocked")]
      : []),
    ...(preflight.blocked > 0
      ? [risk("Preflight blocked", `${preflight.blocked} agent${plural(preflight.blocked)} need attention before approval.`, "blocked")]
      : []),
    ...(preflight.progress > 0 || preflight.queued > 0
      ? [risk("Agent evidence incomplete", `${preflight.progress} live · ${preflight.queued} queued`, "warn")]
      : []),
    ...(!isArtifactReady(plan)
      ? [risk("Plan still draft", "The main plan has not reached a reviewable artifact status.", "warn")]
      : []),
    ...(!isArtifactReady(scenarios)
      ? [risk("Missing scenarios", "Verifier sidecar cannot prove claims without runnable scenarios.", "warn")]
      : []),
    ...(!isArtifactReady(blastRadius)
      ? [risk("Missing impact map", "Reviewers cannot inspect affected files, APIs, or workflows.", "warn")]
      : []),
    ...(!isArtifactReady(executionDag)
      ? [risk("Execution map not ready", "Coding order and dependency safety are not reviewable yet.", "warn")]
      : []),
    ...(missingAssertions > 0
      ? [risk("DAG assertions missing", `${missingAssertions} execution task${plural(missingAssertions)} lack verification assertions.`, "warn")]
      : []),
    ...(gate === "awaiting_user"
      ? [risk("Reviewer action available", "Plan gate is open for approval or requested changes.", "info")]
      : []),
  ];

  return risks.length > 0
    ? risks
    : [risk("No high-risk items", "Artifacts and agent evidence do not expose an immediate review risk.", "ok")];
}

function risk(title: string, detail: string, tone: PlanRiskTone): PlanRisk {
  return { title, detail, tone };
}

function countYamlListItems(body: string, key: string): number {
  const start = body.split("\n").findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return 0;
  return body
    .split("\n")
    .slice(start + 1)
    .filter((line) => /^\s*-\s+/.test(line))
    .length;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function liveEventsToPlanEvents(events: readonly AgentEvent[]): readonly PlanJsonlEvent[] {
  return events.flatMap((event): readonly PlanJsonlEvent[] => {
    if (event.kind === "plan_subagent_started") {
      return [
        {
          kind: "plan_subagent_started",
          ts: toEventDate(event.ts).toISOString(),
          subagent: event.subagent,
          sessionId: event.sessionId,
          ...(event.attemptId ? { attemptId: event.attemptId } : {}),
        },
      ];
    }
    if (event.kind === "plan_subagent_ended") {
      return [
        {
          kind: "plan_subagent_ended",
          ts: toEventDate(event.ts).toISOString(),
          subagent: event.subagent,
          sessionId: event.sessionId,
          ok: event.ok,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.attemptId ? { attemptId: event.attemptId } : {}),
          ...(event.error ? { error: event.error } : {}),
        },
      ];
    }
    return [];
  });
}

function toEventDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function PlanStageProgress({
  gate,
  preflight,
  readiness,
}: {
  readonly gate: PlanGate;
  readonly preflight: PreflightSummary;
  readonly readiness: readonly ReadinessItem[];
}) {
  const artifactsReady = readiness
    .filter((item) => item.label !== "review gate" && item.label !== "blockers")
    .every((item) => item.ready);
  const steps: readonly { readonly label: string; readonly kind: DotKind }[] = [
    { label: "Preflight", kind: preflight.progress > 0 ? "progress" : preflight.blocked > 0 ? "blocked" : "done" },
    { label: "Blast Radius", kind: readiness.find((item) => item.label === "blast radius")?.ready ? "done" : "intake" },
    { label: "Planner", kind: artifactsReady ? "done" : gate === "running" ? "progress" : "intake" },
    { label: "Artifacts", kind: artifactsReady ? "done" : "intake" },
    { label: "Review", kind: gate === "awaiting_user" ? "progress" : "intake" },
  ];

  return (
    <section aria-label="Plan stage progress" className="min-w-0">
      <div className="scroll-hide flex min-w-0 gap-2 overflow-x-auto">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="inline-flex min-h-[34px] shrink-0 items-center gap-2 rounded-full border border-line bg-white/[0.018] px-2.5 font-mono text-[11px] text-fg-mute"
          >
            <StatusIcon kind={statusIconKind(step.kind)} size={12} live={step.kind === "progress"} />
            <span className="text-fg-faint">{index + 1}</span>
            <span className="text-fg-body">{step.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InlinePlanApprovalActions({
  taskId,
  gate,
  taskStatus,
}: {
  readonly taskId: string;
  readonly gate: PlanGate;
  readonly taskStatus: Task["status"];
}) {
  const [pending, start] = useTransition();
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (taskStatus !== "planning" || gate !== "awaiting_user") {
    return (
      <div className="rounded-[8px] border border-line bg-white/[0.015] px-3 py-2 font-mono text-[11px] text-fg-mute">
        Approval unlocks when all required artifacts are ready.
      </div>
    );
  }

  const onApprove = (): void =>
    start(async () => {
      setError(null);
      try {
        await approvePlan(taskId);
      } catch (e) {
        setError(errorMessage(e));
      }
    });

  const onRequestChanges = (): void =>
    start(async () => {
      setError(null);
      try {
        await requestPlanChanges(taskId, comment);
        setComment("");
        setShowComment(false);
      } catch (e) {
        setError(errorMessage(e));
      }
    });

  if (showComment) {
    return (
      <section aria-label="Plan review actions" className="w-full min-w-[280px] max-w-[520px] rounded-[8px] border border-line bg-bg/70 p-3">
        <label className="font-mono text-[11px] text-fg-mute" htmlFor="plan-revision-comment-inline">
          Describe what to change (at least 10 chars)
        </label>
        <textarea
          id="plan-revision-comment-inline"
          className="mt-2 min-h-[68px] w-full resize-none rounded border border-line bg-input p-2 font-mono text-[12.5px] text-fg outline-none focus:border-line-hover"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={pending}
          placeholder="The plan should..."
        />
        {error && <span className="mt-2 block font-mono text-[11px] text-st-blocked">{error}</span>}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-line bg-transparent px-3 py-1.5 text-[12px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-50"
            disabled={pending}
            onClick={() => {
              setShowComment(false);
              setComment("");
              setError(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-st-blocked px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:brightness-110 disabled:opacity-50"
            disabled={pending || comment.trim().length < 10}
            onClick={onRequestChanges}
          >
            Send revision
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Plan review actions" className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
      {error && <span className="font-mono text-[11px] text-st-blocked">{error}</span>}
      <button
        type="button"
        className="rounded border border-line bg-transparent px-3 py-1.5 text-[12px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-50"
        disabled={pending}
        onClick={() => setShowComment(true)}
      >
        Request changes
      </button>
      <button
        type="button"
        className="rounded bg-st-progress px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:brightness-110 disabled:opacity-50"
        disabled={pending}
        onClick={onApprove}
      >
        {pending ? "Approving..." : "Approve plan"}
      </button>
    </section>
  );
}

function PlanRisksPanel({ risks }: { readonly risks: readonly PlanRisk[] }) {
  const blockedCount = risks.filter((item) => item.tone === "blocked").length;
  const warnCount = risks.filter((item) => item.tone === "warn").length;

  return (
    <section
      aria-label="Plan risks"
      className="min-w-0 rounded-[9px] border border-line bg-card"
    >
      <header className="border-b border-line px-3 py-3">
        <div className="text-[13px] font-semibold text-fg">Plan risks</div>
        <div className="mt-1 font-mono text-[10.5px] text-fg-mute">
          {blockedCount} blocked · {warnCount} warnings
        </div>
      </header>
      <div className="grid gap-2 p-3">
        {risks.map((item) => (
          <div
            key={`${item.tone}:${item.title}`}
            className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 rounded-[7px] border border-line bg-white/[0.014] px-2.5 py-2"
          >
            <StatusIcon kind={riskIconKind(item.tone)} size={13} />
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-fg-body">{item.title}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-fg-mute">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function riskIconKind(tone: PlanRiskTone): "intake" | "progress" | "review" | "done" | "blocked" {
  if (tone === "blocked") return "blocked";
  if (tone === "warn") return "review";
  if (tone === "ok") return "done";
  return "intake";
}

function statusIconKind(kind: DotKind): "intake" | "progress" | "review" | "done" | "blocked" {
  if (kind === "fallback") return "review";
  return kind;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Request failed";
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
