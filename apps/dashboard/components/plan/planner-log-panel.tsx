"use client";
import { useMemo, useState } from "react";
import type { AgentEvent } from "@pi-harness/shared";
import { usePlanEvents } from "@/lib/plan-events-context";
import { AgentTimeline } from "./agent-timeline";

// Bottom collapsible panel showing the planner's own tool calls.
//
// The planner emits tool_call / tool_result events without a `subagent`
// field; subagent preflight events are tagged. Filter to the untagged ones
// to isolate the planner's stream. Latest plan_usage event drives the
// header meta (cumulative tokens / cost).
//
// Default-open while planning is in progress. Collapses to a one-line
// header when the user toggles. Body is height-capped and uses .scroll-hide
// so the page never grows beyond the viewport.

export function PlannerLogPanel({
  defaultOpen = true,
}: {
  defaultOpen?: boolean;
}) {
  const { events, connected } = usePlanEvents();
  const [open, setOpen] = useState(defaultOpen);

  const plannerEvents = useMemo(
    () => events.filter((e) => isPlannerToolEvent(e)),
    [events],
  );

  const usage = useMemo(() => latestPlanUsage(events), [events]);
  const lastTickKind = useMemo(() => latestPlanSystemKind(events), [events]);

  const liveLabel = lastTickKind ?? (connected ? "live" : "—");

  return (
    <section className="border-t border-line bg-bg" aria-label="planner agent log">
      <header
        className="flex cursor-pointer items-center gap-2.5 border-b border-line px-6 py-2 hover:bg-card"
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <span className="inline-block w-2.5 font-mono text-[10px] text-fg-mute">
          {open ? "▾" : "▸"}
        </span>
        <h3 className="m-0 font-mono text-[11px] font-medium text-fg-body">
          planner log
        </h3>
        {connected && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-st-progress">
            <span className="pulse-dot" />
            {liveLabel}
          </span>
        )}
        <div className="ml-auto flex gap-3.5 font-mono text-[11px] text-fg-mute">
          {usage && (
            <span>
              tick {usage.tickIndex} · <b className="font-medium text-fg-body">{usage.cumulativeInputTokens.toLocaleString()}</b> in /{" "}
              <b className="font-medium text-fg-body">{usage.cumulativeOutputTokens.toLocaleString()}</b> out
            </span>
          )}
          {usage && <span>${usage.cumulativeCostUsd.toFixed(4)}</span>}
        </div>
      </header>
      {open && (
        <div className="scroll-hide max-h-[200px] overflow-y-auto px-6 py-3">
          <AgentTimeline events={plannerEvents} emptyText="planner hasn't called any tools yet" />
        </div>
      )}
    </section>
  );
}

function isPlannerToolEvent(e: AgentEvent): boolean {
  if (e.kind !== "tool_call" && e.kind !== "tool_result") return false;
  // Untagged → planner-emitted. Subagent events have `subagent` set.
  return (e as AgentEvent & { subagent?: string }).subagent === undefined;
}

function latestPlanUsage(events: AgentEvent[]): {
  tickIndex: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCostUsd: number;
} | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "plan_usage") {
      return {
        tickIndex: e.tickIndex,
        cumulativeInputTokens: e.cumulativeInputTokens,
        cumulativeOutputTokens: e.cumulativeOutputTokens,
        cumulativeCostUsd: e.cumulativeCostUsd,
      };
    }
  }
  return null;
}

function latestPlanSystemKind(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "plan_system") return e.systemKind;
  }
  return null;
}
