"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Run, Task, TaskStatus } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { ChatPanel } from "@/components/brainstorm/chat-panel";
import { ArtifactPane } from "@/components/brainstorm/emerging-spec";
import { ApprovalGate } from "@/components/brainstorm/approval-gate";
import { SplitPane } from "@/components/brainstorm/split-pane";
import { RestartButton } from "@/components/brainstorm/restart-button";
import { StatusIcon } from "@/components/kanban/status-icon";
import { queries } from "@/lib/client/queries";
import type { BrainstormBundle } from "@/lib/api";

const PAST_BRAINSTORM: ReadonlySet<TaskStatus> = new Set([
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
]);

export function BrainstormPageLive({
  taskId,
  initialTask,
  initialBundle,
}: {
  taskId: string;
  initialTask: { task: Task; runs: Run[] };
  initialBundle: BrainstormBundle;
}) {
  const taskQuery = useQuery({ ...queries.getTask(taskId), initialData: initialTask });
  const bundleQuery = useQuery({ ...queries.getBrainstormBundle(taskId), initialData: initialBundle });
  const { task, runs } = taskQuery.data;
  const bundle = bundleQuery.data;
  const brainstormRunId =
    [...runs].reverse().find((run) => run.phase === "brainstorm")?.id ?? null;
  const past = PAST_BRAINSTORM.has(task.status);
  const failed = task.status === "brainstorm_failed";
  const ready = !past && !failed && bundle.gate === "awaiting_user";
  const notStarted = brainstormRunId === null;
  const headerStatus = past
    ? "approved"
    : failed
      ? "failed — restart to retry"
      : notStarted
        ? "not started"
        : ready
          ? "awaiting your approval"
          : "in progress";
  const iconKind = past ? "done" : failed ? "blocked" : notStarted ? "intake" : ready ? "review" : "progress";

  return (
    <>
      <Topbar runningCount={task.status === "brainstorming" && !ready ? 1 : 0} blockedCount={failed ? 1 : 0} doneTodayCount={0} branch="main" />
      <section className="border-b border-line px-6 pb-3.5 pt-4">
        <nav className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
          <Link href="/" className="text-fg-mute hover:text-fg-body">← Board</Link>
          <span className="text-fg-faint">/</span>
          <Link href={`/tasks/${task.id}` as never} className="text-fg-body hover:text-fg">
            {task.id}
          </Link>
          <span className="text-fg-faint">/</span>
          <span className="text-st-review">brainstorm</span>
        </nav>
        <div className="flex items-center gap-3">
          <StatusIcon kind={iconKind} size={16} />
          <h1 className="m-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.018em] text-fg">
            {task.title}
          </h1>
          <span className="font-mono text-[11.5px] text-fg-mute">
            {headerStatus}
            {task.branchName && (
              <>
                {" · "}
                <span className="text-fg-body">{task.branchName}</span>
              </>
            )}
          </span>
          <RestartButton
            taskId={task.id}
            disabled={
              notStarted ||
              (task.status !== "brainstorming" && task.status !== "brainstorm_failed")
            }
          />
        </div>
      </section>

      <main className="h-[calc(100vh-48px-80px)] min-h-0">
        <SplitPane
          className="h-full"
          left={
            <ChatPanel
              taskId={task.id}
              runId={brainstormRunId}
              initialEvents={bundle.events}
              gate={bundle.gate}
              taskStatus={task.status}
            />
          }
          right={
            <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
              <ArtifactPane
                taskId={task.id}
                taskStatus={task.status}
                design={bundle.design}
                spec={bundle.spec}
                runId={brainstormRunId}
              />
              <ApprovalGate
                taskId={task.id}
                gate={bundle.gate}
                taskStatus={task.status}
                runId={brainstormRunId}
              />
            </aside>
          }
        />
      </main>
    </>
  );
}
