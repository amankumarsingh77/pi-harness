import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { BrainstormShell } from "@/components/brainstorm/shell";
import { ApiError } from "@/lib/api";
import { BrainstormEventsProvider } from "@/lib/brainstorm-events-context";
import { orchestrator } from "@/lib/server/api";
import "./brainstorm.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · brainstorm · pi-harness` };
}

export default async function BrainstormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [taskResult, bundle] = await Promise.all([
    orchestrator.getTask(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    orchestrator.getBrainstormBundle(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
  ]);
  const { task, runs } = taskResult;
  // Latest brainstorm run drives the SSE subscription. Null until the run
  // exists (e.g. the user has filed the task but not approved start-brainstorm).
  const brainstormRun = [...runs].reverse().find((r) => r.phase === "brainstorm") ?? null;
  const brainstormRunId = brainstormRun?.id ?? null;
  // waterfall: the run id comes from the task detail response.
  const initialAgentEvents = brainstormRunId
    ? (await orchestrator.listEvents(brainstormRunId)).events
    : [];

  return (
    <>
      <Topbar runningCount={1} blockedCount={1} doneTodayCount={12} branch="main" />

      <BrainstormEventsProvider runId={brainstormRunId}>
        <BrainstormShell
          task={task}
          runId={brainstormRunId}
          gate={bundle.gate}
          design={bundle.design}
          spec={bundle.spec}
          initialEvents={bundle.events}
          initialAgentEvents={initialAgentEvents}
          canCancel={task.status === "brainstorming" && brainstormRun?.status === "running"}
          cancelled={task.status === "brainstorming" && brainstormRun?.status === "cancelled"}
        />
      </BrainstormEventsProvider>
    </>
  );
}
