import { StatusIcon } from "@/components/kanban/status-icon";
import type { PlanJsonlEvent } from "@/lib/api";

// Eight subagents the dashboard renders in the strip — seven research +
// claim-verifier (run from mark_ready). Order is fixed so the dot positions
// don't reshuffle between renders.
const SUBAGENTS = [
  "scope-tracer",
  "codebase-locator",
  "codebase-pattern-finder",
  "codebase-analyzer",
  "integration-scanner",
  "test-case-locator",
  "precedent-locator",
  "claim-verifier",
] as const;

type DotKind = "intake" | "progress" | "done" | "blocked";

// Decide each subagent's dot kind from the bundle:
//   - findings file present → done (regardless of started/ended events)
//   - plan_subagent_started without matching ended → progress
//   - plan_subagent_ended { ok: false } and no findings file → blocked
//   - otherwise → intake (waiting to start)
function deriveKind(
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

// Strip-of-eight progress indicator for the plan-phase preflight. Renders a
// single line of dots when at least one subagent has started; collapses to a
// one-line summary when all eight are `done`. Status-icon SVGs only — no
// Unicode shapes (project rule 3).
export function PreflightProgress({
  research,
  events,
}: {
  research: Record<string, string | null>;
  events: PlanJsonlEvent[];
}) {
  const kinds = SUBAGENTS.map((sa) => ({ name: sa, kind: deriveKind(sa, research, events) }));
  const allDone = kinds.every((k) => k.kind === "done");
  const anyStarted = kinds.some((k) => k.kind !== "intake");

  // Pre-dispatch (nothing started, nothing on disk): hide entirely so the
  // page header doesn't get cluttered before the run-loop fires.
  if (!anyStarted) return null;

  if (allDone) {
    const totalCost = events
      .filter((e) => e.kind === "plan_subagent_ended")
      .reduce((sum, e) => sum + (e as { costUsd: number }).costUsd, 0);
    const totalDurationMs = events
      .filter((e) => e.kind === "plan_subagent_ended")
      .reduce((sum, e) => sum + (e as { durationMs: number }).durationMs, 0);
    return (
      <section className="border-b border-line bg-bg px-6 py-2.5">
        <div className="flex items-center gap-3 font-mono text-[11px] text-fg-mute">
          <StatusIcon kind="done" size={12} />
          <span>
            {SUBAGENTS.length}/{SUBAGENTS.length} research done
          </span>
          {totalCost > 0 && <span>· ${totalCost.toFixed(3)}</span>}
          {totalDurationMs > 0 && <span>· {(totalDurationMs / 1000).toFixed(1)}s</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-line bg-bg px-6 py-2.5">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-fg-mute">research preflight</span>
        <div className="flex items-center gap-2">
          {kinds.map(({ name, kind }) => (
            <span
              key={name}
              title={`${name} — ${kind}`}
              className="inline-flex items-center"
              aria-label={`${name}: ${kind}`}
            >
              <StatusIcon kind={kind} size={12} />
            </span>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-fg-mute">
          {kinds.filter((k) => k.kind === "done").length}/{SUBAGENTS.length} done
        </span>
      </div>
    </section>
  );
}
