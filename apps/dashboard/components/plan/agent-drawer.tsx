"use client";
import { useMemo, useState, useEffect } from "react";
import type { AgentEvent } from "@pi-harness/shared";
import { usePlanEvents } from "@/lib/plan-events-context";
import { AgentTimeline } from "./agent-timeline";
import { AgentFindings } from "./agent-findings";

// Right-side drawer for a single research subagent. Shows two tabs:
//   Timeline — tool calls filtered to this subagent (live)
//   Findings — rendered research/<agent>.md once the agent has finished
//
// The drawer subscribes to the shared plan-events context and filters by
// `e.subagent`. Findings tab is disabled while the body is null; once
// populated, the tab auto-activates so users see the outcome by default.
//
// Footer carries running totals (cost / tokens / duration) sourced from the
// matching plan_subagent_started / plan_subagent_ended events in the same
// stream. Numbers freeze the moment the subagent ends.

type DotKind = "intake" | "progress" | "done" | "blocked";

export function AgentDrawer({
  subagent,
  findingsBody,
  status,
  onClose,
}: {
  subagent: string;
  findingsBody: string | null;
  status: DotKind;
  onClose: () => void;
}) {
  const { events } = usePlanEvents();

  const subagentEvents = useMemo(
    () => events.filter((e) => hasSubagent(e) && e.subagent === subagent),
    [events, subagent],
  );

  const totals = useMemo(() => deriveTotals(events, subagent), [events, subagent]);

  const findingsAvailable = findingsBody !== null;
  const [tab, setTab] = useState<"timeline" | "findings">("timeline");

  // When findings land, switch to Findings — but only for a freshly opened
  // drawer that hasn't been touched. If the user is mid-scroll on Timeline,
  // don't yank them.
  const [autoSwitched, setAutoSwitched] = useState(false);
  useEffect(() => {
    if (findingsAvailable && !autoSwitched) {
      setTab("findings");
      setAutoSwitched(true);
    }
  }, [findingsAvailable, autoSwitched]);

  const liveLabel =
    status === "done"
      ? totals.durationMs
        ? `done · ${formatDuration(totals.durationMs)}`
        : "done"
      : status === "blocked"
        ? "failed"
        : status === "progress"
          ? "live"
          : "queued";

  const liveColor =
    status === "done"
      ? "text-st-done"
      : status === "blocked"
        ? "text-st-blocked"
        : status === "progress"
          ? "text-st-progress"
          : "text-fg-mute";

  return (
    <aside className="flex min-h-0 w-[460px] flex-col border-l border-line bg-card">
      <header className="border-b border-line px-5 pt-4 pb-3">
        <div className="flex items-center gap-2.5 font-mono text-[13px] font-medium text-fg">
          <Dot kind={status} />
          <span className="truncate">{subagent}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-fg-mute hover:bg-card-hover hover:text-fg"
            aria-label="close"
          >
            ×
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-3.5 font-mono text-[11px] text-fg-mute">
          <span className={liveColor}>{liveLabel}</span>
          {totals.inputTokens > 0 && (
            <span>
              {totals.inputTokens.toLocaleString()} in /{" "}
              {totals.outputTokens.toLocaleString()} out
            </span>
          )}
          {totals.costUsd > 0 && <span>${totals.costUsd.toFixed(4)}</span>}
        </div>
      </header>

      <nav className="flex border-b border-line px-5">
        <Tab active={tab === "timeline"} onClick={() => setTab("timeline")}>
          Timeline
        </Tab>
        <Tab
          active={tab === "findings"}
          onClick={() => findingsAvailable && setTab("findings")}
          disabled={!findingsAvailable}
          {...(findingsAvailable ? {} : { title: "available once the agent finishes" })}
        >
          Findings
        </Tab>
      </nav>

      <div className="scroll-hide min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "timeline" ? (
          <AgentTimeline events={subagentEvents} />
        ) : (
          <AgentFindings body={findingsBody} />
        )}
      </div>

      <footer className="flex justify-between gap-3.5 border-t border-line px-5 py-3 font-mono text-[11px] text-fg-mute">
        <span>{rowCounts(subagentEvents)}</span>
        <span>{totals.costUsd > 0 ? `$${totals.costUsd.toFixed(4)}` : "—"}</span>
      </footer>
    </aside>
  );
}

function Tab({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "px-3 py-2.5 -mb-px border-b-[1.5px] text-[12px]",
        active
          ? "border-fg text-fg"
          : disabled
            ? "border-transparent text-fg-faint cursor-default"
            : "border-transparent text-fg-mute hover:text-fg",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Dot({ kind }: { kind: DotKind }) {
  const cls =
    kind === "done"
      ? "bg-st-done border-st-done"
      : kind === "blocked"
        ? "bg-st-blocked border-st-blocked"
        : kind === "progress"
          ? "border-st-progress"
          : "border-fg-faint";
  return (
    <span
      className={`inline-block h-3.5 w-3.5 rounded-full border-[1.5px] ${cls} ${kind === "progress" ? "tick-anim" : ""}`}
      style={
        kind === "progress"
          ? {
              background:
                "conic-gradient(var(--color-st-progress) 0 60%, transparent 60% 100%)",
            }
          : undefined
      }
    />
  );
}

function hasSubagent(
  e: AgentEvent,
): e is AgentEvent & { subagent?: string } {
  return (
    e.kind === "tool_call" ||
    e.kind === "tool_result" ||
    e.kind === "message_delta" ||
    e.kind === "log"
  );
}

type Totals = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

function deriveTotals(events: AgentEvent[], subagent: string): Totals {
  let started: number | null = null;
  const t: Totals = { costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
  for (const e of events) {
    if (e.kind === "plan_subagent_started" && e.subagent === subagent) {
      started = new Date(e.ts).getTime();
    }
    if (e.kind === "plan_subagent_ended" && e.subagent === subagent) {
      t.costUsd = e.costUsd;
      t.inputTokens = e.inputTokens;
      t.outputTokens = e.outputTokens;
      t.durationMs = e.durationMs;
    }
  }
  // While running, derive a soft duration so the user sees seconds tick.
  if (t.durationMs === 0 && started !== null) {
    t.durationMs = Math.max(0, Date.now() - started);
  }
  return t;
}

function rowCounts(events: AgentEvent[]): string {
  const counts: Record<string, number> = {};
  for (const e of events) {
    if (e.kind !== "tool_call") continue;
    const t = e.tool.toLowerCase();
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`);
  return parts.length === 0 ? "no tool calls yet" : parts.join(" · ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}
