"use client";
import { useQuery } from "@tanstack/react-query";
import type { DashboardSummary, Task, TaskStatus } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { queries } from "@/lib/client/queries";
import { KanbanBoard } from "./board";

type BoardData = {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
  humanInterventionTaskIds: readonly string[];
  summary: DashboardSummary;
};

export function BoardLive({ initialData }: { initialData: BoardData }) {
  const { data } = useQuery({
    ...queries.listTasks(),
    initialData,
  });

  return (
    <>
      <Topbar summary={data.summary} branch="main" />
      <KanbanBoard
        tasks={data.tasks}
        counts={data.counts}
        humanInterventionTaskIds={data.humanInterventionTaskIds}
      />
    </>
  );
}
