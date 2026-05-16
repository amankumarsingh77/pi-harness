import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PlanBody } from "@/components/plan/plan-body";
import { PlanApprovalGate } from "@/components/plan/approval-gate";
import { ApiError } from "@/lib/api";
import { PlanEventsProvider } from "@/lib/plan-events-context";
import { orchestrator } from "@/lib/server/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · plan · pi-harness` };
}

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [taskResult, bundle] = await Promise.all([
    orchestrator.getTask(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    orchestrator.getPlanBundle(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
  ]);
  const { task, runs } = taskResult;

  // Latest plan run drives the SSE subscription. Null until the run exists
  // (e.g. before brainstorm has been approved).
  const planRun = [...runs].reverse().find((r) => r.phase === "plan") ?? null;
  const planRunId = planRun?.id ?? null;
  const planRunActive = planRun?.status === "pending" || planRun?.status === "running";

  // Past planning: header status reads "approved" rather than "in progress",
  // matching the brainstorm page's PAST_BRAINSTORM treatment so the header
  // tracks task.status not the (now-stale) gate.
  const past = ["executing", "verifying", "verification_failed", "ready_to_ship", "done"]
    .includes(task.status);
  const failed = task.status === "plan_failed";
  const cancelled = task.status === "planning" && planRun?.status === "cancelled";
  const ready = !past && !failed && bundle.gate === "awaiting_user";
  const headerStatus = past
    ? "approved"
    : failed
      ? "failed — restart to retry"
      : cancelled
        ? "cancelled — restart to retry"
      : ready
        ? "awaiting your approval"
        : task.status === "planning"
          ? "in progress"
          : "not started";
  const iconKind = past
    ? "done"
    : failed
      ? "blocked"
      : cancelled
        ? "blocked"
      : ready
        ? "review"
        : task.status === "planning"
          ? "progress"
          : "intake";

  const plannerLogDefaultOpen = task.status === "planning";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Topbar runningCount={1} blockedCount={0} doneTodayCount={0} branch="main" />

      <PlanEventsProvider runId={planRunId}>
        <PlanBody
          task={task}
          runs={runs}
          gate={bundle.gate}
          headerStatus={headerStatus}
          iconKind={iconKind}
          canCancelRun={task.status === "planning" && bundle.gate === "running" && planRunActive}
          research={bundle.research}
          planEvents={bundle.events}
          plan={bundle.plan}
          blastRadius={bundle.blastRadius}
          scenarios={bundle.scenarios}
          plannerLogDefaultOpen={plannerLogDefaultOpen}
        />

        <PlanApprovalGate
          taskId={task.id}
          gate={bundle.gate}
          taskStatus={task.status}
        />
      </PlanEventsProvider>
    </div>
  );
}
