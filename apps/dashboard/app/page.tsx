import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { KanbanBoard } from "@/components/kanban/board";
import { orchestrator } from "@/lib/server/api";

export const metadata: Metadata = { title: "Board · pi-harness" };

export default async function HomePage() {
  const { tasks, counts } = await orchestrator.listTasks();

  const running =
    (counts.brainstorming ?? 0) +
    (counts.planning ?? 0) +
    (counts.executing ?? 0) +
    (counts.verifying ?? 0);
  const blocked = counts.verification_failed ?? 0;
  const doneToday = countDoneToday(tasks);

  return (
    <>
      <Topbar runningCount={running} blockedCount={blocked} doneTodayCount={doneToday} branch="main" />
      <FilterBar total={tasks.length} />
      <KanbanBoard tasks={tasks} counts={counts} />
    </>
  );
}

function FilterBar({ total }: { total: number }) {
  return (
    <div className="flex h-10 items-center gap-1.5 border-b border-line px-5 text-[12px] text-fg-mute">
      <span className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-white/[0.03] px-2 py-1 text-[11.5px] text-fg-body">
        Status: any
      </span>
      <FilterChip>+ Phase</FilterChip>
      <FilterChip>+ Branch</FilterChip>
      <FilterChip>+ Updated</FilterChip>
      <span className="mx-2 text-fg-faint">|</span>
      <FilterChip>Group by phase</FilterChip>
      <span className="ml-auto font-mono text-[11px] text-fg-subtle">{total} tasks</span>
    </div>
  );
}

function FilterChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-dashed border-line px-2 py-1 text-[11.5px] text-fg-mute transition-colors hover:border-line-hover hover:bg-white/[0.02] hover:text-fg-body">
      {children}
    </span>
  );
}

function countDoneToday(
  tasks: { status: string; updatedAt: Date | string }[],
): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const cutoff = startOfDay.getTime();
  let n = 0;
  for (const t of tasks) {
    if (t.status !== "done") continue;
    const u = t.updatedAt instanceof Date ? t.updatedAt : new Date(t.updatedAt);
    if (u.getTime() >= cutoff) n += 1;
  }
  return n;
}
