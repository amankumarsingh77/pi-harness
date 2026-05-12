import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { BrainstormEventsProvider } from "@/lib/brainstorm-events-context";
import { orchestrator } from "@/lib/server/api";
import { BrainstormPageLive } from "@/components/brainstorm/brainstorm-page-live";

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
  const brainstormRunId =
    [...taskResult.runs].reverse().find((run) => run.phase === "brainstorm")?.id ?? null;

  return (
    <BrainstormEventsProvider runId={brainstormRunId}>
      <BrainstormPageLive taskId={id} initialTask={taskResult} initialBundle={bundle} />
    </BrainstormEventsProvider>
  );
}
