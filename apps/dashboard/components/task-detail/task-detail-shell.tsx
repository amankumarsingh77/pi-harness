import Link from "next/link";
import type { Route } from "next";
import { taskPhaseLabel, taskStatusLabel, type Run, type Task } from "@pi-harness/shared";
import { StatusIcon, statusKindFor } from "@/components/kanban/status-icon";
import { TaskCostStrip } from "./task-cost-strip";

export function TaskDetailShell({
  task,
  runs,
  liveRunId,
  inspectorControls,
  children,
}: {
  readonly task: Task;
  readonly runs: readonly Run[];
  readonly liveRunId: string | null;
  readonly inspectorControls: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1180px] px-4 py-5 md:px-7 md:py-7">
      <nav className="mb-[18px] flex items-center gap-2 font-mono text-[11px] text-fg-mute">
        <Link href="/" className="transition-colors hover:text-fg-body">
          ← Board
        </Link>
        <span className="text-fg-faint">/</span>
        <span className="text-fg-body">{task.id}</span>
      </nav>

      <section className="mb-[22px] grid grid-cols-1 items-start gap-[18px] md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] leading-[1.14] font-semibold tracking-[-0.02em] text-fg md:text-[28px]">
            {task.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <MetaPill>
              <StatusIcon kind={statusKindFor(task.status)} size={12} live={liveRunId !== null} />
              <strong>{taskStatusLabel(task.status)}</strong>
            </MetaPill>
            <MetaPill>
              phase <strong>{taskPhaseLabel(task.status)}</strong>
            </MetaPill>
            <MetaPill>
              branch <strong>{task.branchName ?? "—"}</strong>
            </MetaPill>
            <MetaPill>
              workflow <strong>{task.workflow ?? "—"}</strong>
            </MetaPill>
            <Link
              href="/knowledge"
              className="inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full border border-line bg-white/[0.025] px-2.5 font-mono text-[11px] text-fg-mute transition-colors hover:border-fg-faint hover:text-fg"
            >
              Knowledge
            </Link>
            <Link
              href={`/tasks/${task.id}/mission` as Route}
              className="inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full border border-line bg-white/[0.025] px-2.5 font-mono text-[11px] text-fg-mute transition-colors hover:border-fg-faint hover:text-fg"
            >
              Mission Command
            </Link>
            {runs.length > 0 && (
              <MetaPill>
                <TaskCostStrip initialRuns={[...runs]} liveRunId={liveRunId} />
              </MetaPill>
            )}
          </div>
        </div>
        {inspectorControls}
      </section>

      {children}
    </main>
  );
}

function MetaPill({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full border border-line bg-white/[0.025] px-2.5 font-mono text-[11px] text-fg-mute">
      {children}
    </span>
  );
}
