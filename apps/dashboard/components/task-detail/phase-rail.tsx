import Link from "next/link";
import type { Route } from "next";
import type { Phase, Run } from "@pi-harness/shared";
import { clsx } from "clsx";
import { StatusIcon, type StatusKind } from "@/components/kanban/status-icon";
import { formatDuration } from "@/lib/format";
import type { MockDeepLinks } from "@/types/mocks";

/**
 * Seven-step phase rail. UI taxonomy here ("intake → done") deliberately
 * surrounds the five backend phases ("brainstorm…pr") to give the user a
 * place to put pre-run state and the terminal "merged" state on the same
 * timeline. Source of truth is `runs[]`; intake/done are derived.
 */

type RailStepKind = "intake" | "phase" | "done";

type RailStep =
  | { kind: "intake"; name: "Intake"; state: "done" | "live" | "pending"; meta: string }
  | { kind: "phase"; name: string; phase: Phase; state: "done" | "live" | "pending"; meta: string }
  | { kind: "done"; name: "Done"; state: "done" | "live" | "pending"; meta: string };

const PHASE_LABELS: Record<Phase, string> = {
  brainstorm: "Brainstorm",
  plan: "Plan",
  code: "Code",
  verify: "Verify",
  pr: "PR",
};

const PHASES_ORDER: Phase[] = ["brainstorm", "plan", "code", "verify", "pr"];

function buildSteps(runs: Run[], hasMerged: boolean): RailStep[] {
  const byPhase = new Map<Phase, Run>();
  for (const r of runs) byPhase.set(r.phase, r);

  // Intake: done as soon as any run exists.
  const intake: RailStep = {
    kind: "intake",
    name: "Intake",
    state: runs.length > 0 ? "done" : "live",
    meta: runs.length > 0
      ? formatRunMeta(runs[0]!)
      : "—",
  };

  const phaseSteps: RailStep[] = PHASES_ORDER.map((p) => {
    const r = byPhase.get(p);
    let state: "done" | "live" | "pending" = "pending";
    if (r) {
      state = r.status === "running" ? "live" : r.status === "succeeded" ? "done" : "pending";
    }
    return {
      kind: "phase",
      name: PHASE_LABELS[p],
      phase: p,
      state,
      meta: r ? formatRunMeta(r) : "—",
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

function formatRunMeta(r: Run): string {
  if (r.status === "running") {
    return `${formatDuration(Date.now() - new Date(r.startedAt).getTime())} · live`;
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

export function PhaseRail({
  runs,
  deepLinks,
}: {
  runs: Run[];
  deepLinks: MockDeepLinks;
}) {
  const steps = buildSteps(runs, false);

  return (
    <section className="border-b border-line px-6 py-[18px]">
      <div className="grid grid-cols-7 gap-0">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const connectorActive = step.state === "done";
          return (
            <div key={step.name} className="flex flex-col">
              {/* icon row — fixed height so absolute connector lines up consistently */}
              <div className="relative h-5">
                <span
                  className={clsx(
                    "absolute top-1/2 left-0 z-10 -translate-y-1/2 bg-bg",
                  )}
                  style={{ width: 16, height: 16 }}
                >
                  <StatusIcon kind={iconKindForStep(step)} size={16} live={step.state === "live"} />
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

              {/* label */}
              <div
                className={clsx(
                  "mt-2 text-[11.5px] font-medium tracking-tight capitalize",
                  step.state === "live" ? "text-fg" : "text-fg-mute",
                )}
              >
                {step.name}
              </div>

              {/* meta */}
              <div
                className={clsx(
                  "mt-0.5 font-mono text-[11px]",
                  step.state === "live" ? "text-st-progress" : step.state === "pending" ? "text-fg-faint" : "text-fg-subtle",
                )}
                style={step.state === "live" ? { color: "var(--color-st-progress)" } : undefined}
              >
                {step.meta}
              </div>
            </div>
          );
        })}
      </div>

      <DeepLinks links={deepLinks} />
    </section>
  );
}

function DeepLinks({ links }: { links: MockDeepLinks }) {
  return (
    <div className="mt-4 flex gap-1.5">
      <DeepLink label="Open brainstorm" target={links.brainstorm} />
      <DeepLink label="Open plan" target={links.plan} />
      <DeepLink label="Open verify" target={links.verify} />
    </div>
  );
}

function DeepLink({
  label,
  target,
}: {
  label: string;
  target: { available: true; href: string } | { available: false; reason: string };
}) {
  const base =
    "inline-flex items-center gap-2 rounded px-2.5 py-1.5 text-xs transition-colors";

  if (!target.available) {
    return (
      <span
        className={clsx(
          base,
          "cursor-not-allowed border border-dashed border-line text-fg-faint",
        )}
        title={target.reason}
        aria-disabled="true"
      >
        <Arrow /> {label}
      </span>
    );
  }
  return (
    <Link
      href={target.href as Route}
      className={clsx(
        base,
        "border border-line text-fg-body hover:border-line-hover hover:bg-white/[0.03]",
      )}
    >
      <Arrow /> {label}
    </Link>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M 3 6 L 9 6 M 6 3 L 9 6 L 6 9"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
