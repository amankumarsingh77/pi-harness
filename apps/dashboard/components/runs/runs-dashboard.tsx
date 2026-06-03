"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { RunRow, RunTableHeader } from "@/components/runs/run-row";
import type { MockRun } from "@/types/mocks";

export function RunsDashboard({
  active,
  recent,
}: {
  readonly active: readonly MockRun[];
  readonly recent: readonly MockRun[];
}) {
  const [query, setQuery] = useState("");
  const filteredActive = useMemo(() => filterRuns(active, query), [active, query]);
  const filteredRecent = useMemo(() => filterRuns(recent, query), [recent, query]);
  const filteredCount = filteredActive.length + filteredRecent.length;
  const totalCount = active.length + recent.length;
  const hasQuery = query.trim().length > 0;

  return (
    <>
      <section className="flex flex-col gap-4 px-6 pb-3.5 pt-[22px] md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Runs</h1>
          <div className="mt-1 text-[12.5px] text-fg-mute">
            One row per attempt. Active first, then recent, with searchable task, branch, and outcome metadata.
          </div>
        </div>
        <label className="flex h-9 w-full max-w-[340px] items-center gap-2 rounded-md border border-line bg-input px-2.5 text-[12.5px] text-fg-mute transition-colors focus-within:border-st-progress">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">Filter runs</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by task, run, branch, outcome"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
          {hasQuery && (
            <button
              type="button"
              aria-label="Clear run filter"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-faint transition-colors hover:bg-card-hover hover:text-fg-body"
              onClick={() => setQuery("")}
            >
              <X size={13} strokeWidth={1.9} aria-hidden="true" />
            </button>
          )}
        </label>
      </section>

      {hasQuery && (
        <div className="px-6 pb-1 font-mono text-[11px] text-fg-subtle" role="status">
          {filteredCount} of {totalCount} runs match “{query.trim()}”
        </div>
      )}

      {filteredCount === 0 ? (
        <div className="mx-6 mt-6 rounded-lg border border-dashed border-line bg-card px-5 py-8 text-center">
          <div className="text-[14px] font-medium text-fg">No runs match this filter</div>
          <p className="mx-auto mb-0 mt-1 max-w-md text-[12.5px] leading-5 text-fg-mute">
            Search task titles, task ids, run ids, branches, phases, outcomes, or pull request numbers.
          </p>
        </div>
      ) : (
        <>
          <RunsGroup title="active" count={filteredActive.length} runs={filteredActive} outcomeLabel="Phase" />
          <RunsGroup
            title="recent · last 48h"
            count={filteredRecent.length}
            runs={filteredRecent}
            outcomeLabel="Outcome"
            withDaySeparators
          />
        </>
      )}
    </>
  );
}

function RunsGroup({
  title,
  count,
  runs,
  outcomeLabel,
  withDaySeparators = false,
}: {
  readonly title: string;
  readonly count: number;
  readonly runs: readonly MockRun[];
  readonly outcomeLabel: string;
  readonly withDaySeparators?: boolean;
}) {
  if (runs.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline gap-2.5 px-6 pb-2 pt-[18px]">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">{title}</span>
        <span className="font-mono text-[10.5px] text-fg-faint">{count}</span>
      </div>
      <RunTableHeader outcomeLabel={outcomeLabel} />
      {withDaySeparators ? <RunListWithDays runs={runs} /> : <RunList runs={runs} />}
    </section>
  );
}

function RunList({ runs }: { readonly runs: readonly MockRun[] }) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  return (
    <div className="border-b border-line">
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          expanded={expandedRunId === run.id}
          onToggle={() => setExpandedRunId((current) => (current === run.id ? null : run.id))}
        />
      ))}
    </div>
  );
}

function RunListWithDays({ runs }: { readonly runs: readonly MockRun[] }) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const groups = groupByDay(runs);

  return (
    <div className="border-b border-line">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="flex h-[26px] items-center border-b border-line px-6 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-faint">
            {group.label}
          </div>
          {group.runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedRunId === run.id}
              onToggle={() => setExpandedRunId((current) => (current === run.id ? null : run.id))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function filterRuns(runs: readonly MockRun[], query: string): readonly MockRun[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return runs;
  return runs.filter((run) => searchableRunText(run).includes(needle));
}

function searchableRunText(run: MockRun): string {
  return [
    run.id,
    run.taskId,
    run.taskTitle,
    run.branch,
    run.outcome.kind,
    "phase" in run.outcome ? run.outcome.phase : "",
    "pr" in run.outcome ? `#${run.outcome.pr}` : "",
  ].join(" ").toLowerCase();
}

function groupByDay(runs: readonly MockRun[]): readonly { readonly label: string; readonly runs: readonly MockRun[] }[] {
  const today = "2026-05-09";
  const yesterday = "2026-05-08";
  const buckets = runs.reduce<Map<string, MockRun[]>>((acc, run) => {
    const day = run.startedAt.slice(0, 10);
    return new Map(acc).set(day, [...(acc.get(day) ?? []), run]);
  }, new Map<string, MockRun[]>());
  const labelFor = (day: string): string => {
    if (day === today) return "today · may 9";
    if (day === yesterday) return "yesterday · may 8";
    return day;
  };
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, groupRuns]) => ({ label: labelFor(day), runs: groupRuns }));
}
