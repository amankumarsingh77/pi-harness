"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { AgentEvent, Run, Task } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import { RunContext } from "@/components/task-detail/run-context";
import { StatusIcon, statusKindFor } from "@/components/kanban/status-icon";
import { TaskActions } from "@/components/task-detail/task-actions";
import { TaskCostStrip } from "@/components/task-detail/task-cost-strip";
import { queries } from "@/lib/client/queries";
import type { RunFile } from "@/lib/api";

type TaskDetailData = {
  task: Task;
  runs: Run[];
};

export function TaskDetailLive({
  taskId,
  requestedRunId,
  initialTask,
  initialEvents,
  initialFiles,
}: {
  taskId: string;
  requestedRunId?: string;
  initialTask: TaskDetailData;
  initialEvents: AgentEvent[];
  initialFiles: RunFile[];
}) {
  const { data } = useQuery({
    ...queries.getTask(taskId),
    initialData: initialTask,
  });
  const selectedRun =
    (requestedRunId ? data.runs.find((run) => run.id === requestedRunId) : undefined) ??
    data.runs.at(-1);
  const liveRun = data.runs.find((run) => run.status === "running") ?? null;
  const filesQuery = useQuery({
    ...queries.listRunFiles(selectedRun?.id ?? "none"),
    enabled: selectedRun !== undefined,
    initialData: selectedRun?.id === initialTask.runs.at(-1)?.id ? { files: initialFiles } : undefined,
  });

  return (
    <>
      <Topbar runningCount={liveRun ? 1 : 0} blockedCount={0} doneTodayCount={0} branch="main" />

      <Head task={data.task} runs={data.runs} liveRunId={liveRun?.id ?? null} />
      <PhaseRail runs={data.runs} taskId={data.task.id} />

      <main className="grid min-h-[calc(100vh-48px-64px-100px)] grid-cols-[1fr_320px] gap-0">
        <section className="flex min-w-0 flex-col border-r border-line">
          <AgentLog
            events={initialEvents}
            runId={selectedRun?.id ?? "—"}
            live={liveRun !== null && liveRun.id === selectedRun?.id}
          />
        </section>
        <RunContext
          task={data.task}
          runs={data.runs}
          files={filesQuery.data?.files ?? initialFiles}
          {...(selectedRun ? { selectedRunId: selectedRun.id } : {})}
        />
      </main>
    </>
  );
}

function Head({
  task,
  runs,
  liveRunId,
}: {
  task: Task;
  runs: Run[];
  liveRunId: string | null;
}) {
  const kind = statusKindFor(task.status);
  return (
    <section className="border-b border-line px-6 pt-[18px] pb-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-mute-2">
        <Link href="/" className="text-fg-mute hover:text-fg-body">
          ← Board
        </Link>
        <span className="text-fg-faint">/</span>
        <span className="text-fg-body">{task.id}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <StatusIcon kind={kind} size={18} live={kind === "progress"} />
        <h1 className="m-0 flex-1 text-[19px] font-semibold tracking-tight text-fg">
          {task.title}
        </h1>
        <TaskCostStrip initialRuns={runs} liveRunId={liveRunId} />
        <TaskActions task={task} />
      </div>
    </section>
  );
}
