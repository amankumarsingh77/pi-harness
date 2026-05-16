import Link from "next/link";
import type { Route } from "next";
import type { Phase, Run, Task, TaskStatus } from "@pi-harness/shared";
import { clsx } from "clsx";
import { StatusIcon, type StatusKind } from "@/components/kanban/status-icon";
import { formatDuration, formatRelativeCompact } from "@/lib/format";
import { LiveDuration } from "./live-duration";
import type { TaskIntervention } from "./task-intervention";

type StepState = "done" | "current" | "queued" | "failed" | "cancelled";

type PhaseStep = {
  readonly kind: "phase";
  readonly phase: Phase;
  readonly name: string;
  readonly state: StepState;
  readonly meta: React.ReactNode;
  readonly href?: Route;
};

type TaskStep =
  | {
      readonly kind: "intake";
      readonly name: "Intake";
      readonly state: StepState;
      readonly meta: React.ReactNode;
    }
  | PhaseStep
  | {
      readonly kind: "done";
      readonly name: "Done";
      readonly state: StepState;
      readonly meta: React.ReactNode;
    };

const PHASES: ReadonlyArray<Phase> = ["brainstorm", "plan", "code", "verify", "pr"];

const PHASE_LABELS: Record<Phase, string> = {
  brainstorm: "Brainstorm",
  plan: "Plan",
  code: "Code",
  verify: "Verify",
  pr: "PR",
};

export function TaskPhaseStrip({
  task,
  runs,
  intervention = null,
}: {
  readonly task: Task;
  readonly runs: readonly Run[];
  readonly intervention?: TaskIntervention | null;
}) {
  const steps = buildSteps({ task, runs, intervention });

  return (
    <section
      aria-label="Task phases"
      className="mb-[22px] grid grid-cols-1 overflow-hidden rounded-[10px] border border-line bg-white/[0.018] md:grid-cols-7"
    >
      {steps.map((step) => {
        const body = <TaskPhaseBody step={step} />;
        const ariaCurrent =
          step.state === "current" ? `Current phase: ${step.name}` : undefined;

        if (step.kind === "phase" && step.href) {
          return (
            <Link
              key={step.name}
              href={step.href}
              aria-label={`Open ${step.name.toLowerCase()}`}
              aria-current={step.state === "current" ? "step" : undefined}
              className={phaseClassName(step.state)}
            >
              {body}
              {ariaCurrent && <span className="sr-only">{ariaCurrent}</span>}
            </Link>
          );
        }

        return (
          <div
            key={step.name}
            aria-current={step.state === "current" ? "step" : undefined}
            className={phaseClassName(step.state)}
          >
            {body}
            {ariaCurrent && <span className="sr-only">{ariaCurrent}</span>}
          </div>
        );
      })}
    </section>
  );
}

function TaskPhaseBody({ step }: { readonly step: TaskStep }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[12px] font-medium text-fg-body">
        <StatusIcon
          kind={statusKindForStep(step)}
          size={12}
          live={step.state === "current" && statusKindForStep(step) === "progress"}
        />
        <span>{step.name}</span>
      </div>
      <div className="mt-2 font-mono text-[10.5px] text-fg-subtle">{step.meta}</div>
    </>
  );
}

function buildSteps({
  task,
  runs,
  intervention,
}: {
  readonly task: Task;
  readonly runs: readonly Run[];
  readonly intervention: TaskIntervention | null;
}): readonly TaskStep[] {
  const currentPhase = currentPhaseForStatus(task.status);
  const runByPhase = new Map<Phase, Run>(runs.map((run) => [run.phase, run]));
  const intake: TaskStep = {
    kind: "intake",
    name: "Intake",
    state: runs.length > 0 ? "done" : "current",
    meta: `filed ${formatRelativeCompact(task.createdAt)} ago`,
  };

  const phaseSteps = PHASES.map((phase): PhaseStep => {
    const run = runByPhase.get(phase);
    const state = stateForPhase({ phase, run, currentPhase });
    const href = hrefForPhase(task.id, phase, runs);
    return {
      kind: "phase",
      phase,
      name: PHASE_LABELS[phase],
      state,
      meta: metaForPhase({ phase, run, state, intervention }),
      ...(href ? { href } : {}),
    };
  });

  const done: TaskStep = {
    kind: "done",
    name: "Done",
    state: task.status === "done" ? "done" : "queued",
    meta: task.status === "done" ? "merged" : "pending",
  };

  return [intake, ...phaseSteps, done];
}

function stateForPhase({
  phase,
  run,
  currentPhase,
}: {
  readonly phase: Phase;
  readonly run: Run | undefined;
  readonly currentPhase: Phase | null;
}): StepState {
  if (phase === currentPhase) return "current";
  if (!run) return "queued";
  if (run.status === "succeeded") return "done";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "running") return "current";
  return "queued";
}

function metaForPhase({
  phase,
  run,
  state,
  intervention,
}: {
  readonly phase: Phase;
  readonly run: Run | undefined;
  readonly state: StepState;
  readonly intervention: TaskIntervention | null;
}): React.ReactNode {
  if (intervention?.phase === phase) return intervention.cta.toLowerCase();
  if (!run) return state === "current" ? "starting" : "queued";
  if (run.status === "running") return <LiveDuration startedAt={run.startedAt} suffix="live" />;
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  if (run.endedAt) {
    return formatDuration(
      new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime(),
    );
  }
  return "queued";
}

function hrefForPhase(taskId: string, phase: Phase, runs: readonly Run[]): Route | undefined {
  const run = runs.find((item) => item.phase === phase);
  switch (phase) {
    case "brainstorm":
      return run ? (`/tasks/${taskId}/brainstorm` as Route) : undefined;
    case "plan":
      return run ? (`/tasks/${taskId}/plan` as Route) : undefined;
    case "verify": {
      const codeRun = runs.find((item) => item.phase === "code");
      return codeRun ? (`/tasks/${taskId}/verify` as Route) : undefined;
    }
    case "code":
    case "pr":
      return undefined;
  }
}

function currentPhaseForStatus(status: TaskStatus): Phase | null {
  switch (status) {
    case "brainstorming":
    case "brainstorm_failed":
      return "brainstorm";
    case "planning":
    case "plan_failed":
      return "plan";
    case "executing":
    case "code_failed":
      return "code";
    case "verifying":
    case "verification_failed":
      return "verify";
    case "ready_to_ship":
    case "pr_failed":
      return "pr";
    case "backlog":
    case "done":
    case "cancelled":
      return null;
  }
}

function statusKindForStep(step: TaskStep): StatusKind {
  if (step.state === "done") return "done";
  if (step.state === "failed" || step.state === "cancelled") return "blocked";
  if (step.state === "current") {
    return step.kind === "phase" && step.phase === "plan" ? "review" : "progress";
  }
  return "intake";
}

function phaseClassName(state: StepState): string {
  return clsx(
    "relative min-h-[74px] border-b border-line px-3 py-[13px] transition-colors hover:bg-white/[0.035] md:border-r md:border-b-0 md:last:border-r-0",
    state === "current" &&
      "bg-[rgba(94,106,210,0.12)] before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-st-progress before:shadow-[0_0_18px_rgba(94,106,210,0.55)]",
  );
}
