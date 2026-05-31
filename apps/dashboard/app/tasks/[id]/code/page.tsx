import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";
import { CodeEventsProvider } from "@/lib/code-events-context";
import { CodePageLive } from "@/components/code/code-page-live";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · code · pi-harness` };
}

export default async function CodePage({ params }: { params: Promise<{ id: string }> }) {
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
  const codeRunId =
    [...taskResult.runs].reverse().find((run) => run.phase === "code")?.id ?? null;
  // waterfall: the code run id comes from the task run list.
  const initialEvents = codeRunId ? (await orchestrator.listEvents(codeRunId)).events : [];

  return (
    <CodeEventsProvider runId={codeRunId} initialEvents={initialEvents}>
      <CodePageLive taskId={id} initialTask={taskResult} initialBundle={bundle} />
    </CodeEventsProvider>
  );
}
