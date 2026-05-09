import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { RunRow, RunTableHeader } from "@/components/runs/run-row";
import { MOCK_RUNS, isActive } from "@/lib/server/_fixtures/runs";
import type { MockRun } from "@/types/mocks";

export const metadata: Metadata = { title: "Runs · pi-harness" };

export default function RunsPage() {
  const active = MOCK_RUNS.filter(isActive);
  const recent = MOCK_RUNS.filter((r) => !isActive(r));
  const running = MOCK_RUNS.filter((r) => r.outcome.kind === "running").length;
  const blocked = MOCK_RUNS.filter((r) => r.outcome.kind === "blocked").length;
  const doneToday = MOCK_RUNS.filter(
    (r) => r.outcome.kind === "merged" && r.startedAt.startsWith("2026-05-09"),
  ).length;

  return (
    <>
      <Topbar runningCount={running} blockedCount={blocked} doneTodayCount={doneToday} branch="main" />
      <PageHead />
      <RunsGroup title="active" count={active.length} runs={active} outcomeLabel="Phase" />
      <RunsGroup
        title="recent · last 48h"
        count={recent.length}
        runs={recent}
        outcomeLabel="Outcome"
        withDaySeparators
      />
    </>
  );
}

function PageHead() {
  return (
    <section className="flex items-end justify-between gap-5 px-6 pt-[22px] pb-3.5">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Runs</h1>
        <div className="mt-1 text-[12.5px] text-fg-mute">
          One row per attempt. Active first, then recent — to spot stuck runs and compare retries of the same task.
        </div>
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded border border-line bg-card px-2.5 py-1 font-mono text-[11.5px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body"
      >
        filter by task… <span className="ml-1 text-fg-faint">⌘F</span>
      </button>
    </section>
  );
}

function RunsGroup({
  title,
  count,
  runs,
  outcomeLabel,
  withDaySeparators = false,
}: {
  title: string;
  count: number;
  runs: MockRun[];
  outcomeLabel: string;
  withDaySeparators?: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2.5 px-6 pt-[18px] pb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">{title}</span>
        <span className="font-mono text-[10.5px] text-fg-faint">{count}</span>
      </div>
      <RunTableHeader outcomeLabel={outcomeLabel} />
      {withDaySeparators ? <RunListWithDays runs={runs} /> : <RunList runs={runs} />}
    </section>
  );
}

function RunList({ runs }: { runs: MockRun[] }) {
  return (
    <div className="border-b border-line">
      {runs.map((r) => (
        <RunRow key={r.id} run={r} />
      ))}
    </div>
  );
}

function RunListWithDays({ runs }: { runs: MockRun[] }) {
  const groups = groupByDay(runs);
  return (
    <div className="border-b border-line">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="flex h-[26px] items-center border-b border-line px-6 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-faint">
            {g.label}
          </div>
          {g.runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      ))}
    </div>
  );
}

function groupByDay(runs: MockRun[]): { label: string; runs: MockRun[] }[] {
  const today = "2026-05-09";
  const yesterday = "2026-05-08";
  const buckets = new Map<string, MockRun[]>();
  for (const r of runs) {
    const day = r.startedAt.slice(0, 10);
    const list = buckets.get(day) ?? [];
    list.push(r);
    buckets.set(day, list);
  }
  const labelFor = (day: string): string => {
    if (day === today) return "today · may 9";
    if (day === yesterday) return "yesterday · may 8";
    return day;
  };
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, runs]) => ({ label: labelFor(day), runs }));
}
