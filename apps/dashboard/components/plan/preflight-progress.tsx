"use client";
import { PREFLIGHT_SUBAGENTS } from "@pi-harness/subagents/metadata";
import { StatusIcon } from "@/components/kanban/status-icon";
import type { PlanJsonlEvent } from "@/lib/api";

// Strip = preflight research subagents + the post-plan claim-verifier (run
// from mark_ready). Order follows registry declaration order so dot positions
// don't reshuffle between renders.
export const SUBAGENTS: readonly string[] = [
  ...PREFLIGHT_SUBAGENTS,
  "claim-verifier",
];

export type DotKind = "intake" | "progress" | "done" | "blocked";

// Decide each subagent's dot kind from the bundle:
//   - findings file present → done (regardless of started/ended events)
//   - plan_subagent_started without matching ended → progress
//   - plan_subagent_ended { ok: false } and no findings file → blocked
//   - otherwise → intake (waiting to start)
export function deriveKind(
  subagent: string,
  research: Record<string, string | null>,
  events: PlanJsonlEvent[],
): DotKind {
  if (research[subagent]) return "done";
  let started = false;
  let endedOk: boolean | null = null;
  for (const e of events) {
    if (e.kind === "plan_subagent_started" && e.subagent === subagent) started = true;
    if (e.kind === "plan_subagent_ended" && e.subagent === subagent) endedOk = e.ok;
  }
  if (endedOk === false) return "blocked";
  if (started) return "progress";
  return "intake";
}

// Strip-of-six progress indicator for the plan-phase preflight. Each dot is
// a clickable button: clicking opens the per-agent drawer for that subagent.
// Collapses to a one-line summary when every subagent is `done`.
// Status-icon SVGs only — no Unicode shapes (project rule 3).
export function PreflightProgress({
  research,
  events,
  selectedSubagent,
  onSelect,
}: {
  research: Record<string, string | null>;
  events: PlanJsonlEvent[];
  selectedSubagent?: string | null;
  onSelect?: (subagent: string) => void;
}) {
  const kinds = SUBAGENTS.map((sa) => ({ name: sa, kind: deriveKind(sa, research, events) }));
  const anyStarted = kinds.some((k) => k.kind !== "intake");

  // Pre-dispatch (nothing started, nothing on disk): hide entirely so the
  // page header doesn't get cluttered before the run-loop fires.
  if (!anyStarted) return null;

  return (
    <section className="border-b border-line bg-bg px-6 py-2.5">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-fg-mute">research preflight</span>
        <div className="flex items-center gap-1.5">
          {kinds.map(({ name, kind }) => {
            const selected = selectedSubagent === name;
            const interactive = !!onSelect;
            return (
              <button
                key={name}
                type="button"
                onClick={interactive ? () => onSelect(name) : undefined}
                disabled={!interactive}
                title={`${name} — ${kind}`}
                aria-label={`${name}: ${kind}`}
                aria-pressed={selected}
                className={[
                  "inline-flex h-[22px] w-[22px] items-center justify-center rounded transition-colors",
                  interactive ? "cursor-pointer hover:bg-card" : "cursor-default",
                  selected ? "bg-card ring-1 ring-inset ring-line-strong" : "",
                ].join(" ")}
              >
                <StatusIcon kind={kind} size={12} />
              </button>
            );
          })}
        </div>
        <span className="ml-auto font-mono text-[11px] text-fg-mute">
          {kinds.filter((k) => k.kind === "done").length}/{SUBAGENTS.length} done
          {onSelect ? " · click to inspect" : ""}
        </span>
      </div>
    </section>
  );
}
