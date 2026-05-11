import type { Metadata } from "next";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import { RunContext } from "@/components/task-detail/run-context";
import { StatusIcon, statusKindFor } from "@/components/kanban/status-icon";
import { TaskActions } from "@/components/task-detail/task-actions";
import { TaskCostStrip } from "@/components/task-detail/task-cost-strip";
import type { Run } from "@pi-harness/shared";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

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

  const { task, runs } = await orchestrator.getTask(id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });

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

  const liveRun = runs.find((r) => r.status === "running") ?? null;

  return (
    <>
      <Topbar
        runningCount={1}
        blockedCount={1}
        doneTodayCount={12}
        branch="main"
      />

      <Head task={task} runs={runs} liveRunId={liveRun?.id ?? null} />
      <PhaseRail runs={runs} taskId={task.id} />

      <main className="grid min-h-[calc(100vh-48px-64px-100px)] grid-cols-[1fr_320px] gap-0">
        <section className="flex min-w-0 flex-col border-r border-line">
          <AgentLog
            events={events}
            runId={selectedRun?.id ?? "—"}
            live={liveRun !== null && liveRun.id === selectedRun?.id}
          />
        </section>
        <RunContext
          task={task}
          runs={runs}
          files={files}
          {...(selectedRun ? { selectedRunId: selectedRun.id } : {})}
        />
      </main>
    </>
  );
}

function Head({
  task,
  runs,
  liveRunId,
}: {
  task: import("@pi-harness/shared").Task;
  runs: Run[];
  liveRunId: string | null;
}) {
  const kind = statusKindFor(task.status);
  return (
    <section className="border-b border-line px-6 pt-[18px] pb-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-mute-2">
        <Link href="/" className="text-fg-mute hover:text-fg-body">
          ← Board
        </Link>
        <span className="text-fg-faint">/</span>
        <span className="text-fg-body">{task.id}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <StatusIcon kind={kind} size={18} live={kind === "progress"} />
        <h1 className="m-0 flex-1 text-[19px] font-semibold tracking-tight text-fg">
          {task.title}
        </h1>
        <TaskCostStrip initialRuns={runs} liveRunId={liveRunId} />
        <TaskActions task={task} />
      </div>
    </section>
  );
}
