import type { Metadata } from "next";
import {
  deriveTaskIntervention,
} from "@/components/task-detail/task-intervention";
import type { Task } from "@pi-harness/shared";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";
import { TaskDetailLive } from "@/components/task-detail/task-detail-live";

/**
 * Task detail page. Layout (top → bottom), aligned to:
 * docs/mocks/task-detail-focused-command-2026-05-16.html
 *
 *   topbar           shared with kanban
 *   focused shell    breadcrumb + title + metadata + read-only inspector controls
 *   intervention     optional thin link to the phase page that needs input
 *   phase strip      compact 7-step phase surface
 *   panels           latest activity | task facts
 *
 * `?run=<id>` selects which run is inspected in read-only drawers/modals.
 * Workflow decisions remain on phase pages, never on this detail page.
 */

export const dynamic = "force-dynamic";

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

  const eventsPromise = selectedRun
    ? orchestrator.listEvents(selectedRun.id).then((r) => r.events)
    : Promise.resolve([]);
  const filesPromise = selectedRun
    ? orchestrator
        .listRunFiles(selectedRun.id)
        .then((r) => r.files)
        .catch(() => [])
    : Promise.resolve([]);
  const interventionPromise = getTaskIntervention(task);

  const [events, files, intervention] = await Promise.all([
    eventsPromise,
    filesPromise,
    interventionPromise,
  ]);

  return (
    <TaskDetailLive
      taskId={task.id}
      {...(requestedRunId ? { requestedRunId } : {})}
      initialTask={taskResult}
      initialEvents={events}
      initialFiles={files}
      initialIntervention={intervention}
    />
  );
}

async function getTaskIntervention(task: Task) {
  if (task.status === "brainstorming") {
    const bundle = await optionalNotFound(orchestrator.getBrainstormBundle(task.id));
    return deriveTaskIntervention({
      task,
      ...(bundle ? { brainstorm: { gate: bundle.gate, events: bundle.events } } : {}),
    });
  }

  if (task.status === "planning") {
    const bundle = await optionalNotFound(orchestrator.getPlanBundle(task.id));
    return deriveTaskIntervention({
      task,
      ...(bundle ? { plan: { gate: bundle.gate } } : {}),
    });
  }

  return deriveTaskIntervention({ task });
}

async function optionalNotFound<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
