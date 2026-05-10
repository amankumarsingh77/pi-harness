"use client";
import { useEffect, useMemo, useState } from "react";
import type { BrainstormGate, BrainstormJsonlEvent } from "@/lib/api";
import { useBrainstormEvents } from "@/lib/brainstorm-events-context";

// Right-edge of the brainstorm page header. Surfaces:
//   <elapsed> · <ticks> ticks · <input>k in / <output>k out · $<cost>
// Updates live via SSE on every brainstorm_usage event; stops the elapsed
// counter once the gate flips to awaiting_user.
export function CostStrip({
  runId,
  gate,
  initialEvents,
}: {
  runId: string | null;
  gate: BrainstormGate;
  initialEvents: BrainstormJsonlEvent[];
}) {
  const { events: liveEvents } = useBrainstormEvents();

  // Aggregate the latest cumulative stats from initial + live streams. The
  // server-rendered initial values cover the SSR pass; the live stream
  // replaces them once the first brainstorm_usage envelope arrives.
  const stats = useMemo(() => {
    let cumIn = 0;
    let cumOut = 0;
    let cumCost = 0;
    let ticks = 0;
    let earliestTs: number | null = null;

    for (const e of initialEvents) {
      const ts = Date.parse(e.ts);
      if (!Number.isNaN(ts) && (earliestTs === null || ts < earliestTs)) {
        earliestTs = ts;
      }
      if (e.kind === "brainstorm_usage") {
        cumIn = e.cumulativeInputTokens;
        cumOut = e.cumulativeOutputTokens;
        cumCost = e.cumulativeCostUsd;
        ticks = e.tickIndex + 1;
      }
    }
    for (const e of liveEvents) {
      const ts = e.ts instanceof Date ? e.ts.getTime() : Date.parse(String(e.ts));
      if (!Number.isNaN(ts) && (earliestTs === null || ts < earliestTs)) {
        earliestTs = ts;
      }
      if (e.kind === "brainstorm_usage") {
        cumIn = e.cumulativeInputTokens;
        cumOut = e.cumulativeOutputTokens;
        cumCost = e.cumulativeCostUsd;
        ticks = e.tickIndex + 1;
      }
    }

    return { cumIn, cumOut, cumCost, ticks, earliestTs };
  }, [initialEvents, liveEvents]);

  // Elapsed time. Ticks every second while the brainstorm is running; stops
  // (and freezes the displayed value) when the gate flips to awaiting_user.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (gate === "awaiting_user") return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [gate]);

  if (runId === null && stats.ticks === 0) return null;

  const elapsedSec =
    stats.earliestTs === null
      ? 0
      : Math.max(0, Math.floor((nowMs - stats.earliestTs) / 1000));

  return (
    <span
      className="font-mono text-[11px] text-fg-mute"
      data-testid="cost-strip"
    >
      {fmtElapsed(elapsedSec)} · {stats.ticks} ticks ·{" "}
      {fmtTokens(stats.cumIn)} in / {fmtTokens(stats.cumOut)} out ·{" "}
      {fmtCost(stats.cumCost)}
    </span>
  );
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
