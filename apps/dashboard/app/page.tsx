import type { Metadata } from "next";
import { BoardLive } from "@/components/kanban/board-live";
import { orchestrator } from "@/lib/server/api";

export const metadata: Metadata = { title: "Board · pi-harness" };

export default async function HomePage() {
  const initialData = await orchestrator.listTasks();
  return <BoardLive initialData={initialData} />;
}
