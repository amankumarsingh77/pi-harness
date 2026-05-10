import Link from "next/link";
import type { Route } from "next";
import type { Phase, Run } from "@pi-harness/shared";
import { clsx } from "clsx";
import { StatusIcon, type StatusKind } from "@/components/kanban/status-icon";
import { formatDuration } from "@/lib/format";
import { LiveDuration } from "./live-duration";

/**
 * Seven-step phase rail. UI taxonomy here ("intake → done") deliberately
 * surrounds the five backend phases ("brainstorm…pr") to give the user a
 * place to put pre-run state and the terminal "merged" state on the same
 * timeline. Source of truth is `runs[]`; intake/done are derived.
 *
 * Phase steps with output (brainstorm/plan/verify) are clickable links to
 * their sub-page. The "Open →" affordance shows on hover — no separate
 * button row.
 */

type StepState = "done" | "live" | "pending";

type RailStep =
  | { kind: "intake"; name: "Intake"; state: StepState; meta: React.ReactNode }
  | {
      kind: "phase";
      name: string;
      phase: Phase;
      state: StepState;
      meta: React.ReactNode;
      href?: Route;
    }
  | { kind: "done"; name: "Done"; state: StepState; meta: React.ReactNode };

const PHASE_LABELS: Record<Phase, string> = {
  brainstorm: "Brainstorm",
  plan: "Plan",
  code: "Code",
  verify: "Verify",
  pr: "PR",
};

const PHASES_ORDER: Phase[] = ["brainstorm", "plan", "code", "verify", "pr"];

function buildSteps(taskId: string, runs: Run[], hasMerged: boolean): RailStep[] {
  const byPhase = new Map<Phase, Run>();
  for (const r of runs) byPhase.set(r.phase, r);

  const intake: RailStep = {
    kind: "intake",
    name: "Intake",
    state: runs.length > 0 ? "done" : "live",
    meta: runs.length > 0 ? formatRunMeta(runs[0]!) : "—",
  };

  const phaseSteps: RailStep[] = PHASES_ORDER.map((p) => {
    const r = byPhase.get(p);
    let state: StepState = "pending";
    if (r) {
      state =
        r.status === "running" ? "live" : r.status === "succeeded" ? "done" : "pending";
    }
    const href = deepLinkFor(taskId, p, runs);
    return {
      kind: "phase",
      name: PHASE_LABELS[p],
      phase: p,
      state,
      meta: r ? formatRunMeta(r) : "—",
      ...(href ? { href } : {}),
    };
  });

  const done: RailStep = {
    kind: "done",
    name: "Done",
    state: hasMerged ? "done" : "pending",
    meta: hasMerged ? "merged" : "—",
  };

  return [intake, ...phaseSteps, done];
}

// A phase step links to its detail page only when output exists. Brainstorm/
// plan unlock as soon as their run starts (the pages handle in-flight state).
// Verify requires the code phase to have at least started, since the proof
// report is written by the verifier consuming code's worktree state.
function deepLinkFor(taskId: string, phase: Phase, runs: Run[]): Route | undefined {
  const r = runs.find((x) => x.phase === phase);
  switch (phase) {
    case "brainstorm":
      return r ? (`/tasks/${taskId}/brainstorm` as Route) : undefined;
    case "plan":
      return r ? (`/tasks/${taskId}/plan` as Route) : undefined;
    case "verify": {
      const codeRun = runs.find((x) => x.phase === "code");
      return codeRun && codeRun.status !== "pending"
        ? (`/tasks/${taskId}/verify` as Route)
        : undefined;
    }
    default:
      return undefined;
  }
}

function formatRunMeta(r: Run): React.ReactNode {
  if (r.status === "running") {
    return <LiveDuration startedAt={r.startedAt} suffix="live" />;
  }
  if (r.endedAt && r.status === "succeeded") {
    return formatDuration(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime());
  }
  if (r.status === "failed") return "failed";
  return "—";
}

function iconKindForStep(s: RailStep): StatusKind {
  if (s.state === "done") return "done";
  if (s.state === "live") return "progress";
  return "intake";
}

export function PhaseRail({ runs, taskId }: { runs: Run[]; taskId: string }) {
  const steps = buildSteps(taskId, runs, false);

  return (
    <section className="border-b border-line px-6 py-[18px]">
      <div className="grid grid-cols-7 gap-0">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const connectorActive = step.state === "done";
          const href = step.kind === "phase" ? step.href : undefined;
          const Body = (
            <div className="group/step flex flex-col">
              <div className="relative h-5">
                <span
                  className="absolute top-1/2 left-0 z-10 -translate-y-1/2 bg-bg"
                  style={{ width: 16, height: 16 }}
                >
                  <StatusIcon
                    kind={iconKindForStep(step)}
                    size={16}
                    live={step.state === "live"}
                  />
                </span>
                {!isLast && (
                  <span
                    className={clsx(
                      "absolute top-1/2 right-0 left-6 h-px -translate-y-[0.5px]",
                      connectorActive ? "bg-st-done/40" : "bg-line",
                    )}
                    style={
                      connectorActive
                        ? { backgroundColor: "rgba(76,183,130,0.4)" }
                        : undefined
                    }
                  />
                )}
              </div>

              <div
                className={clsx(
                  "mt-2 flex items-center gap-1 text-[11.5px] font-medium tracking-tight capitalize",
                  step.state === "live" ? "text-fg" : "text-fg-mute",
                  href && "group-hover/step:text-fg",
                )}
              >
                <span>{step.name}</span>
                {href && (
                  <span
                    className="text-fg-faint opacity-0 transition-opacity group-hover/step:opacity-100"
                    aria-hidden
                  >
                    →
                  </span>
                )}
              </div>

              <div
                className={clsx(
                  "mt-0.5 font-mono text-[11px]",
                  step.state === "live"
                    ? "text-st-progress"
                    : step.state === "pending"
                      ? "text-fg-faint"
                      : "text-fg-subtle",
                )}
                style={
                  step.state === "live"
                    ? { color: "var(--color-st-progress)" }
                    : undefined
                }
              >
                {step.meta}
              </div>
            </div>
          );

          return href ? (
            <Link
              key={step.name}
              href={href}
              className="-mx-1 rounded px-1 transition-colors hover:bg-white/[0.02]"
              aria-label={`Open ${step.name.toLowerCase()}`}
            >
              {Body}
            </Link>
          ) : (
            <div key={step.name}>{Body}</div>
          );
        })}
      </div>
    </section>
  );
}
