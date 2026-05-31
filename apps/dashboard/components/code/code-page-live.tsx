"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Run, Task } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { CodeHeader, type CodePhaseStatus } from "@/components/code/code-header";
import { CodeWavesPane } from "@/components/code/code-waves-pane";
import { CodeNodeDetail } from "@/components/code/code-node-detail";
import { queries } from "@/lib/client/queries";
import { useCodeEvents } from "@/lib/code-events-context";
import { parseExecutionDag } from "@/lib/code/parse-execution-dag";
import { deriveCodeState } from "@/lib/code/derive-code-state";
import type { PlanBundle } from "@/lib/api";

export function CodePageLive({
  taskId,
  initialTask,
  initialBundle,
}: {
  readonly taskId: string;
  readonly initialTask: { task: Task; runs: Run[] };
  readonly initialBundle: PlanBundle;
}) {
  const taskQuery = useQuery({ ...queries.getTask(taskId), initialData: initialTask });
  const bundleQuery = useQuery({ ...queries.getPlanBundle(taskId), initialData: initialBundle });
  const { events } = useCodeEvents();

  const { task } = taskQuery.data;
  const dag = useMemo(
    () => parseExecutionDag(bundleQuery.data.executionDag?.body ?? ""),
    [bundleQuery.data.executionDag],
  );
  const state = useMemo(() => deriveCodeState(dag, events), [dag, events]);

  const [selected, setSelected] = useState<string | null>(null);
  const selectedId = selected ?? state.autoSelectedNodeId;
  const node = selectedId ? state.nodesById.get(selectedId) ?? null : null;

  const phaseStatus = phaseStatusFor(task.status, state.metrics.totalCount, state.metrics.doneCount);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Topbar
        runningCount={task.status === "executing" ? 1 : 0}
        blockedCount={task.status === "code_failed" ? 1 : 0}
        doneTodayCount={0}
        branch={task.branchName ?? "main"}
      />
      <CodeHeader taskId={taskId} phaseStatus={phaseStatus} metrics={state.metrics} />
      <div className="grid min-h-0 flex-1 grid-cols-[372px_1fr]">
        <CodeWavesPane
          waves={state.waves}
          metrics={state.metrics}
          selectedNodeId={selectedId}
          onSelect={setSelected}
        />
        <CodeNodeDetail node={node} />
      </div>
    </div>
  );
}

function phaseStatusFor(
  status: Task["status"],
  totalCount: number,
  doneCount: number,
): CodePhaseStatus {
  if (status === "code_failed") return "failed";
  if (status === "executing") return "in progress";
  // Past the code phase (verifying / ready_to_ship / done): complete if any node
  // landed; otherwise the DAG is just a preview of an unstarted run.
  if (isPastCode(status)) return totalCount > 0 && doneCount === totalCount ? "complete" : "not started";
  return "not started";
}

function isPastCode(status: Task["status"]): boolean {
  return (
    status === "verifying" ||
    status === "verification_failed" ||
    status === "ready_to_ship" ||
    status === "pr_failed" ||
    status === "done"
  );
}
