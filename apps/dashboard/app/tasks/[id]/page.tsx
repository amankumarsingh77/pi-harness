import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { TaskActivityPanel } from "@/components/task-detail/task-activity-panel";
import {
  type ArtifactSummary,
  TaskDetailInspectors,
} from "@/components/task-detail/task-detail-inspectors";
import { TaskDetailShell } from "@/components/task-detail/task-detail-shell";
import { TaskFactsPanel } from "@/components/task-detail/task-facts-panel";
import { TaskPhaseStrip } from "@/components/task-detail/task-phase-strip";
import {
  deriveTaskIntervention,
  TaskInterventionStrip,
} from "@/components/task-detail/task-intervention";
import type { Run, Task } from "@pi-harness/shared";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

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

  const { task, runs } = await orchestrator.getTask(id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });

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

  const liveRun = runs.find((r) => r.status === "running") ?? null;
  const artifactSummaries = buildArtifactSummaries(task, runs);

  return (
    <>
      <Topbar
        runningCount={1}
        blockedCount={1}
        doneTodayCount={12}
        branch="main"
      />

      <TaskDetailShell
        task={task}
        runs={runs}
        liveRunId={liveRun?.id ?? null}
        inspectorControls={
          <TaskDetailInspectors
            events={events}
            files={files}
            artifactSummaries={artifactSummaries}
            runId={selectedRun?.id ?? "—"}
            live={liveRun !== null && liveRun.id === selectedRun?.id}
          />
        }
      >
        {intervention && <TaskInterventionStrip intervention={intervention} />}
        <TaskPhaseStrip task={task} runs={runs} intervention={intervention} />

        <section className="grid grid-cols-1 gap-[18px] md:grid-cols-[minmax(0,1fr)_310px]">
          <TaskActivityPanel events={events} />
          <TaskFactsPanel
            task={task}
            runs={runs}
            files={files}
            {...(selectedRun ? { selectedRunId: selectedRun.id } : {})}
          />
        </section>
      </TaskDetailShell>
    </>
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

  const names = artifactNamesForPhase(phase);
  return names.map((name) => ({
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
      return ["plan.md", "blast-radius.yaml", "scenarios.yaml"];
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
