import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";
import { PlanEventsProvider } from "@/lib/plan-events-context";
import { PlanPageLive } from "@/components/plan/plan-page-live";

export const dynamic = "force-dynamic";

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
  const planRunId =
    [...taskResult.runs].reverse().find((run) => run.phase === "plan")?.id ?? null;

  return (
    <PlanEventsProvider runId={planRunId}>
      <PlanPageLive taskId={id} initialTask={taskResult} initialBundle={bundle} />
    </PlanEventsProvider>
  );
}
