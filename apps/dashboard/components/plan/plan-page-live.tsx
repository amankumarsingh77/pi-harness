"use client";

import { useQuery } from "@tanstack/react-query";
import type { Run, Task } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { PlanApprovalGate } from "@/components/plan/approval-gate";
import { PlanBody } from "@/components/plan/plan-body";
import { queries } from "@/lib/client/queries";
import type { PlanBundle } from "@/lib/api";

export function PlanPageLive({
  taskId,
  initialTask,
  initialBundle,
}: {
  taskId: string;
  initialTask: { task: Task; runs: Run[] };
  initialBundle: PlanBundle;
}) {
  const taskQuery = useQuery({ ...queries.getTask(taskId), initialData: initialTask });
  const bundleQuery = useQuery({ ...queries.getPlanBundle(taskId), initialData: initialBundle });
  const { task, runs } = taskQuery.data;
  const bundle = bundleQuery.data;
  const planRun = [...runs].reverse().find((run) => run.phase === "plan") ?? null;
  const planRunActive = planRun?.status === "pending" || planRun?.status === "running";
  const past = ["executing", "verifying", "verification_failed", "ready_to_ship", "done"]
    .includes(task.status);
  const failed = task.status === "plan_failed";
  const cancelled = task.status === "planning" && planRun?.status === "cancelled";
  const ready = !past && !failed && bundle.gate === "awaiting_user";
  const headerStatus = past
    ? "approved"
    : failed
      ? "failed - restart to retry"
      : cancelled
        ? "cancelled - restart to retry"
        : ready
          ? "awaiting your approval"
          : task.status === "planning"
            ? "in progress"
            : "not started";
  const iconKind = past
    ? "done"
    : failed || cancelled
      ? "blocked"
      : ready
        ? "review"
        : task.status === "planning"
          ? "progress"
          : "intake";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Topbar runningCount={task.status === "planning" ? 1 : 0} blockedCount={failed ? 1 : 0} doneTodayCount={0} branch="main" />
      <PlanBody
        task={task}
        runs={runs}
        gate={bundle.gate}
        headerStatus={headerStatus}
        iconKind={iconKind}
        canCancelRun={task.status === "planning" && bundle.gate === "running" && planRunActive}
        research={bundle.research}
        planEvents={bundle.events}
        preflightSteps={bundle.preflightSteps}
        plan={bundle.plan}
        phasePlans={bundle.phasePlans ?? []}
        blastRadius={bundle.blastRadius}
        scenarios={bundle.scenarios}
        executionDag={bundle.executionDag}
        plannerLogDefaultOpen={task.status === "planning"}
        lastBlocked={bundle.lastBlocked}
      />
      <PlanApprovalGate taskId={task.id} gate={bundle.gate} taskStatus={task.status} />
    </div>
  );
}
