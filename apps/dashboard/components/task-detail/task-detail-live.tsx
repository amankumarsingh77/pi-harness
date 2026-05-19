"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentEvent, Run, Task } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { TaskActivityPanel } from "@/components/task-detail/task-activity-panel";
import {
  type ArtifactSummary,
  TaskDetailInspectors,
} from "@/components/task-detail/task-detail-inspectors";
import { TaskDetailShell } from "@/components/task-detail/task-detail-shell";
import { TaskFactsPanel } from "@/components/task-detail/task-facts-panel";
import { TaskPhaseStrip } from "@/components/task-detail/task-phase-strip";
import { StartBrainstormButton } from "@/components/task-detail/start-brainstorm-button";
import {
  type TaskIntervention,
  TaskInterventionStrip,
} from "@/components/task-detail/task-intervention";
import { queries } from "@/lib/client/queries";
import { RunLiveProvider } from "@/lib/run-live-provider";
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
  initialIntervention,
}: {
  taskId: string;
  requestedRunId?: string;
  initialTask: TaskDetailData;
  initialEvents: AgentEvent[];
  initialFiles: RunFile[];
  initialIntervention: TaskIntervention | null;
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
    initialData:
      selectedRun?.id === initialTask.runs.at(-1)?.id
        ? { files: initialFiles }
        : undefined,
  });
  const files = filesQuery.data?.files ?? initialFiles;
  const artifactSummaries = buildArtifactSummaries(data.task, data.runs);

  return (
    <RunLiveProvider runId={liveRun?.id ?? null} initialEvents={initialEvents}>
      <Topbar runningCount={liveRun ? 1 : 0} blockedCount={0} doneTodayCount={0} branch="main" />

      <TaskDetailShell
        task={data.task}
        runs={data.runs}
        liveRunId={liveRun?.id ?? null}
        inspectorControls={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <StartBrainstormButton task={data.task} />
            <TaskDetailInspectors
              events={initialEvents}
              files={files}
              artifactSummaries={artifactSummaries}
              runId={selectedRun?.id ?? "-"}
              live={liveRun !== null && liveRun.id === selectedRun?.id}
            />
          </div>
        }
      >
        {initialIntervention && <TaskInterventionStrip intervention={initialIntervention} />}
        <TaskPhaseStrip task={data.task} runs={data.runs} intervention={initialIntervention} />

        <section className="grid grid-cols-1 gap-[18px] md:grid-cols-[minmax(0,1fr)_310px]">
          <TaskActivityPanel events={initialEvents} />
          <TaskFactsPanel
            task={data.task}
            runs={data.runs}
            files={files}
            {...(selectedRun ? { selectedRunId: selectedRun.id } : {})}
          />
        </section>
      </TaskDetailShell>
    </RunLiveProvider>
  );
}

function buildArtifactSummaries(task: Task, runs: readonly Run[]): readonly ArtifactSummary[] {
  return [
    ...artifactSummariesForPhase(task.id, "brainstorm", runs),
    ...artifactSummariesForPhase(task.id, "plan", runs),
    ...artifactSummariesForPhase(task.id, "verify", runs),
  ];
}

function artifactSummariesForPhase(
  taskId: string,
  phase: ArtifactSummary["phase"],
  runs: readonly Run[],
): readonly ArtifactSummary[] {
  const run = runs.find((item) => item.phase === phase);
  if (!run) return [];

  return artifactNamesForPhase(phase).map((name) => ({
    name,
    status: artifactStatusForRun(run),
    lines: null,
    phase,
    href: `/tasks/${taskId}/${phase}`,
    preview: artifactPreviewForPhase(phase, name),
  }));
}

function artifactNamesForPhase(phase: ArtifactSummary["phase"]): readonly string[] {
  switch (phase) {
    case "brainstorm":
      return ["design.md", "spec.md"];
    case "plan":
      return ["plan.md", "blast-radius.yaml", "scenarios.yaml", "execution-dag.yaml"];
    case "verify":
      return ["proof-report.md"];
  }
}

function artifactStatusForRun(run: Run): string {
  switch (run.status) {
    case "running":
      return "active";
    case "succeeded":
      return "ready";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "pending":
      return "queued";
  }
}

function artifactPreviewForPhase(phase: ArtifactSummary["phase"], name: string): string {
  switch (phase) {
    case "brainstorm":
      return `${name} is produced by the brainstorm phase. Open the brainstorm page to inspect the full design and spec artifacts.`;
    case "plan":
      return `${name} is produced by the plan phase. Open the plan page to review implementation steps, scenarios, and approval controls.`;
    case "verify":
      return `${name} is produced by verification. Open the verify page to inspect proof and remaining blockers.`;
  }
}
