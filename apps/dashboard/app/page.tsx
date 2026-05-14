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
      <BoardSummary
        total={tasks.length}
        backlog={counts.backlog ?? 0}
        running={running}
        blocked={blocked}
      />
      <KanbanBoard tasks={tasks} counts={counts} />
    </>
  );
}

function BoardSummary({
  total,
  backlog,
  running,
  blocked,
}: {
  total: number;
  backlog: number;
  running: number;
  blocked: number;
}) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-line px-5 text-[12px] text-fg-mute">
      <span className="font-medium text-fg-body">Phase board</span>
      <SummaryMetric label="backlog" value={backlog} />
      <SummaryMetric label="running" value={running} />
      <SummaryMetric label="blocked" value={blocked} tone={blocked > 0 ? "blocked" : "default"} />
      <span className="ml-auto font-mono text-[11px] text-fg-subtle">{total} tasks</span>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "blocked";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
      <span className={tone === "blocked" ? "text-st-blocked" : "text-fg-body"}>{value}</span>
      {label}
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
