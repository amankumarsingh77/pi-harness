"use client";
import { useEffect, useMemo, useState } from "react";
import type { Run } from "@pi-harness/shared";
import { useOptionalRunLiveEvents } from "@/lib/run-live-provider";

// Combined live cost/tokens/elapsed for the whole task, rendered in the
// task-detail head row. Aggregates persisted per-phase costs from runs[]
// and overrides the live run's contribution with the latest cumulative
// usage event from its SSE stream.
//
// Today only brainstorm/plan emit `_usage` events. For code/verify/pr we
// fall back to the run row's `costUsd`, which is 0 until the run ends.
export function TaskCostStrip({
  initialRuns,
  liveRunId,
}: {
  initialRuns: Run[];
  liveRunId: string | null;
}) {
  const live = useOptionalRunLiveEvents();
  const liveEvents = useMemo(
    () => (liveRunId ? live?.events ?? [] : []),
    [live?.events, liveRunId],
  );

  const liveUsage = useMemo(() => latestUsage(liveEvents), [liveEvents]);

  const totals = useMemo(() => {
    let cost = 0;
    let cin = 0;
    let cout = 0;
    for (const r of initialRuns) {
      if (r.id === liveRunId) continue;
      cost += r.costUsd;
      cin += r.inputTokens;
      cout += r.outputTokens;
    }
    if (liveRunId) {
      const live = initialRuns.find((r) => r.id === liveRunId);
      if (liveUsage) {
        cost += liveUsage.cumulativeCostUsd;
        cin += liveUsage.cumulativeInputTokens;
        cout += liveUsage.cumulativeOutputTokens;
      } else if (live) {
        cost += live.costUsd;
        cin += live.inputTokens;
        cout += live.outputTokens;
      }
    }
    return { cost, cin, cout };
  }, [initialRuns, liveRunId, liveUsage]);

  const earliestStartMs = useMemo(() => {
    let earliest: number | null = null;
    for (const r of initialRuns) {
      const t = new Date(r.startedAt).getTime();
      if (!Number.isNaN(t) && (earliest === null || t < earliest)) earliest = t;
    }
    return earliest;
  }, [initialRuns]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!liveRunId) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveRunId]);

  if (initialRuns.length === 0) return null;

  const elapsedMs = elapsedFor(initialRuns, liveRunId, earliestStartMs, nowMs);
  const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));

  return (
    <span className="font-mono text-[11px] text-fg-mute" data-testid="task-cost-strip">
      <b className="font-medium text-fg-body">{fmtCost(totals.cost)}</b>
      {" · "}
      {fmtTokens(totals.cin)} in / {fmtTokens(totals.cout)} out
      {" · "}
      {fmtElapsed(elapsedSec)}
    </span>
  );
}

type Usage = {
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCostUsd: number;
};

function latestUsage(events: ReadonlyArray<{ kind: string } & Partial<Usage>>): Usage | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "brainstorm_usage" || e.kind === "plan_usage") {
      return {
        cumulativeInputTokens: e.cumulativeInputTokens ?? 0,
        cumulativeOutputTokens: e.cumulativeOutputTokens ?? 0,
        cumulativeCostUsd: e.cumulativeCostUsd ?? 0,
      };
    }
  }
  return null;
}

// Elapsed = (end of last run | now-if-live) − earliest start. When no live
// run, we freeze at the latest endedAt so a finished task still shows its
// total wall-clock.
function elapsedFor(
  runs: Run[],
  liveRunId: string | null,
  earliestStartMs: number | null,
  nowMs: number,
): number {
  if (earliestStartMs === null) return 0;
  if (liveRunId) return nowMs - earliestStartMs;
  let latestEnd = 0;
  for (const r of runs) {
    if (r.endedAt) {
      const t = new Date(r.endedAt).getTime();
      if (!Number.isNaN(t) && t > latestEnd) latestEnd = t;
    }
  }
  if (latestEnd === 0) return 0;
  return latestEnd - earliestStartMs;
}

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function fmtCost(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
