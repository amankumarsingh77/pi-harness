import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";
import { TaskDetailLive } from "@/components/task-detail/task-detail-live";

/**
 * Task detail page. Layout (top → bottom):
 *
 *   topbar           shared with kanban
 *   head             breadcrumb + title + action row
 *   phase-rail       7-step rail (steps are clickable into sub-pages)
 *   body grid        live agent log | run-context sidebar
 *
 * `?run=<id>` selects which run's events to display in the agent log.
 * Without it, the latest run is shown.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · pi-harness` };
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const requestedRunId = typeof sp.run === "string" ? sp.run : undefined;

  const taskResult = await orchestrator.getTask(id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const { task, runs } = taskResult;

  const selectedRun =
    (requestedRunId ? runs.find((r) => r.id === requestedRunId) : undefined) ??
    runs.at(-1);

  // Parallel fetch: events + files for the selected run. Both depend on the
  // selectedRun id resolved above, so they share the waterfall but run
  // concurrently against each other.
  const [events, files] = selectedRun
    ? await Promise.all([
        orchestrator.listEvents(selectedRun.id).then((r) => r.events),
        orchestrator
          .listRunFiles(selectedRun.id)
          .then((r) => r.files)
          .catch(() => []),
      ])
    : [[], []];

  return (
    <TaskDetailLive
      taskId={task.id}
      {...(requestedRunId ? { requestedRunId } : {})}
      initialTask={taskResult}
      initialEvents={events}
      initialFiles={files}
    />
  );
}
