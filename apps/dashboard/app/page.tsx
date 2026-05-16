import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { KanbanBoard } from "@/components/kanban/board";
import { orchestrator } from "@/lib/server/api";

export const metadata: Metadata = { title: "Board · pi-harness" };

export default async function HomePage() {
  const { tasks, counts, humanInterventionTaskIds, summary } = await orchestrator.listTasks();

  return (
    <>
      <Topbar summary={summary} branch="main" />
      <KanbanBoard
        tasks={tasks}
        counts={counts}
        humanInterventionTaskIds={humanInterventionTaskIds}
      />
    </>
  );
}
