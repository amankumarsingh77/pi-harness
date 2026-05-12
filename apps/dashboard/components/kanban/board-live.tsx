"use client";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { queries } from "@/lib/client/queries";
import { KanbanBoard } from "./board";

type BoardData = {
  tasks: Task[];
  counts: Record<string, number>;
};

export function BoardLive({ initialData }: { initialData: BoardData }) {
  const { data } = useQuery({
    ...queries.listTasks(),
    initialData,
  });
  const running =
    (data.counts.brainstorming ?? 0) +
    (data.counts.planning ?? 0) +
    (data.counts.executing ?? 0) +
    (data.counts.verifying ?? 0);
  const blocked =
    (data.counts.brainstorm_failed ?? 0) +
    (data.counts.plan_failed ?? 0) +
    (data.counts.code_failed ?? 0) +
    (data.counts.verification_failed ?? 0) +
    (data.counts.pr_failed ?? 0);
  const doneToday = countDoneToday(data.tasks);

  return (
    <>
      <Topbar runningCount={running} blockedCount={blocked} doneTodayCount={doneToday} branch="main" />
      <FilterBar total={data.tasks.length} />
      <KanbanBoard tasks={data.tasks} counts={data.counts} />
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
  return tasks.filter((task) => {
    if (task.status !== "done") return false;
    const updatedAt = task.updatedAt instanceof Date ? task.updatedAt : new Date(task.updatedAt);
    return updatedAt.getTime() >= cutoff;
  }).length;
}
