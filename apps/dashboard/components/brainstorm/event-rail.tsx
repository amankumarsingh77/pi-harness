"use client";

import { useEffect, useState } from "react";
import { useAutoScrollToBottom } from "./use-auto-scroll-to-bottom";
import type {
  BlockedEvent,
  BrainstormHealth,
  RailRow,
  RailTone,
} from "./use-brainstorm-timeline";

export function EventRail({
  rows,
  pinnedBlocked,
  health,
  jumpCommitSha,
}: {
  readonly rows: ReadonlyArray<RailRow>;
  readonly pinnedBlocked: BlockedEvent | null;
  readonly health: BrainstormHealth;
  readonly jumpCommitSha: string | null;
}) {
  const { ref, newCount, scrollToBottom } = useAutoScrollToBottom<HTMLDivElement>({
    itemCount: rows.length,
  });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [pulsing, setPulsing] = useState<string | null>(null);

  useEffect(() => {
    if (jumpCommitSha === null || !ref.current) return;
    const row = rows.find((candidate) => candidate.commitSha === jumpCommitSha);
    if (!row) return;
    const node = ref.current.querySelector<HTMLElement>(`[data-row-id="${row.id}"]`);
    node?.scrollIntoView({ block: "center" });
    setPulsing(row.id);
    const timeout = window.setTimeout(() => setPulsing(null), 800);
    return () => window.clearTimeout(timeout);
  }, [jumpCommitSha, ref, rows]);

  const toggleExpanded = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="brainstorm-rail" aria-label="Brainstorm event rail">
      <header>
        <span>Rail</span>
        <span className="ml-auto">{rows.length} events</span>
        <LiveIndicator health={health} />
      </header>
      {pinnedBlocked && (
        <button
          type="button"
          className="brainstorm-rail-blocked"
          onClick={() => toggleExpanded(`blocked:${pinnedBlocked.ts}`)}
        >
          <span className="font-mono text-[10.5px] uppercase text-st-blocked">
            brainstorm blocked
          </span>
          <span className="block truncate text-left text-[12px] text-fg-body">
            {blockedReason(pinnedBlocked)}
          </span>
        </button>
      )}
      <div ref={ref} className="brainstorm-rail-stream" tabIndex={0}>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-3 font-mono text-[11px] text-fg-mute">
            <span className="pulse-dot" aria-hidden="true" />
            awaiting first event...
          </div>
        ) : (
          rows.map((row, index) => (
            <RailRowView
              key={row.id}
              row={row}
              current={index === rows.length - 1}
              expanded={expanded.has(row.id)}
              pulsing={pulsing === row.id}
              onToggle={() => toggleExpanded(row.id)}
            />
          ))
        )}
      </div>
      {newCount > 0 && (
        <button type="button" className="brainstorm-new-events" onClick={scrollToBottom}>
          {newCount} new events
        </button>
      )}
    </aside>
  );
}

function RailRowView({
  row,
  current,
  expanded,
  pulsing,
  onToggle,
}: {
  readonly row: RailRow;
  readonly current: boolean;
  readonly expanded: boolean;
  readonly pulsing: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-row-id={row.id}
      data-commit-sha={row.commitSha ?? ""}
      className={`brainstorm-rail-row ${toneClass(row.tone)} ${current ? "is-current" : ""} ${
        expanded ? "is-expanded" : ""
      } ${pulsing ? "is-pulsing" : ""}`}
      aria-label={`${formatTime(row.ts)} ${row.label}`}
      onClick={onToggle}
    >
      <span className="rail-glyph" aria-hidden="true" />
      <span className="rail-time">{formatTime(row.ts)}</span>
      <span className="rail-label">{row.label}</span>
    </button>
  );
}

function LiveIndicator({ health }: { readonly health: BrainstormHealth }) {
  if (health === "frozen") {
    return <span className="brainstorm-live is-frozen">frozen</span>;
  }
  if (health === "reconnecting") {
    return <span className="brainstorm-live is-reconnecting">reconnecting...</span>;
  }
  return (
    <span className="brainstorm-live is-live">
      <span className="pulse-dot" aria-hidden="true" />
      live
    </span>
  );
}

function toneClass(tone: RailTone): string {
  return `tone-${tone}`;
}

function blockedReason(event: BlockedEvent): string {
  const reason = event.data?.["reason"];
  return typeof reason === "string" ? reason : "unknown reason";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
