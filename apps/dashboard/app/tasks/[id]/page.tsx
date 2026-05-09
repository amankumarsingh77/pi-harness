import type { Metadata } from "next";
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import { RunContext } from "@/components/task-detail/run-context";
import { StatusIcon, statusKindFor } from "@/components/kanban/status-icon";
import { TaskActions } from "@/components/task-detail/task-actions";
import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";
import { MOCK_TASK_DETAIL } from "@/lib/server/_fixtures/task-detail";
import type { MockDeepLinks } from "@/types/mocks";

/**
 * Task detail page. Layout (top → bottom):
 *
 *   topbar           shared with kanban
 *   head             breadcrumb + title + action row
 *   phase-rail       7-step rail + deep-link strip
 *   body grid        live agent log | run-context sidebar
 *
 * UI-first phase: data flows from `orchestrator` (currently a mock — see
 * lib/api.ts), plus mock-only fields (subagents/files-touched/run-history/
 * deep-link availability) that the real backend doesn't emit yet. When the
 * orchestrator is wired, only `MOCK_TASK_DETAIL` mock-only fields need a
 * real source.
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { task, runs } = await orchestrator.getTask(id).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const lastRun = runs.at(-1);
  // waterfall: listEvents needs lastRun.id, which only exists after getTask resolves
  const initialEvents = lastRun
    ? (await orchestrator.listEvents(lastRun.id)).events
    : [];

  // Mock-only side data — keyed off the same task for now.
  const { subagents, filesTouched, runHistory } = MOCK_TASK_DETAIL;

  // Deep links must point at the *real* task id, not the fixture's TASK_ID.
  // Verify is gated on the code phase having run.
  const hasCodeRun = runs.some((r) => r.phase === "code" && r.status !== "pending");
  const deepLinks: MockDeepLinks = {
    brainstorm: { available: true, href: `/tasks/${task.id}/brainstorm` },
    plan: { available: true, href: `/tasks/${task.id}/plan` },
    verify: hasCodeRun
      ? { available: true, href: `/tasks/${task.id}/verify` }
      : { available: false, reason: "Code phase has not finished yet" },
  };

  const liveRun = runs.find((r) => r.status === "running") ?? null;

  return (
    <>
      <Topbar
        runningCount={1}
        blockedCount={1}
        doneTodayCount={12}
        branch="main"
      />

      <Head task={task} />
      <PhaseRail runs={runs} deepLinks={deepLinks} />

      <main className="grid min-h-[calc(100vh-48px-64px-100px)] grid-cols-[1fr_320px] gap-0">
        <section className="flex min-w-0 flex-col border-r border-line">
          <AgentLog
            events={initialEvents}
            runId={lastRun?.id ?? "—"}
            live={liveRun !== null}
          />
        </section>
        <RunContext
          task={task}
          runs={runs}
          subagents={subagents}
          filesTouched={filesTouched}
          runHistory={runHistory}
        />
      </main>
    </>
  );
}

function Head({ task }: { task: import("@pi-harness/shared").Task }) {
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
        <TaskActions task={task} />
      </div>
    </section>
  );
}

