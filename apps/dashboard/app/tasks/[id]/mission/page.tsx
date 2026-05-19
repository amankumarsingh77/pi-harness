import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Route } from "next";
import { MissionCommandLive } from "@/components/mission/mission-command-live";
import { TaskDetailShell } from "@/components/task-detail/task-detail-shell";
import { Topbar } from "@/components/topbar";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · mission · pi-harness` };
}

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [taskResult, missionBundle] = await Promise.all([
    orchestrator.getTask(id).catch(handleNotFound),
    orchestrator.getMission(id).catch(handleNotFound),
  ]);
  const liveRun = taskResult.runs.find((run) => run.status === "running") ?? null;

  return (
    <>
      <Topbar
        runningCount={liveRun ? 1 : 0}
        blockedCount={taskResult.runs.filter((run) => run.status === "failed").length}
        doneTodayCount={0}
        branch={taskResult.task.branchName ?? "main"}
      />
      <TaskDetailShell
        task={taskResult.task}
        runs={taskResult.runs}
        liveRunId={liveRun?.id ?? null}
        inspectorControls={
          <Link
            href={`/tasks/${taskResult.task.id}` as Route}
            className="inline-flex h-9 items-center rounded-[8px] border border-line bg-white/[0.03] px-3 font-mono text-[12px] text-fg-mute transition-colors hover:border-fg-faint hover:text-fg"
          >
            Task overview
          </Link>
        }
      >
        <MissionCommandLive
          taskId={taskResult.task.id}
          initialTask={taskResult}
          initialMission={missionBundle}
        />
      </TaskDetailShell>
    </>
  );
}

function handleNotFound(error: unknown): never {
  if (error instanceof ApiError && error.status === 404) notFound();
  throw error;
}
