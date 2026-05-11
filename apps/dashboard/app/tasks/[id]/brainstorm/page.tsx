import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { ChatPanel } from "@/components/brainstorm/chat-panel";
import { ArtifactPane } from "@/components/brainstorm/emerging-spec";
import { ApprovalGate } from "@/components/brainstorm/approval-gate";
import { SplitPane } from "@/components/brainstorm/split-pane";
import { RestartButton } from "@/components/brainstorm/restart-button";
import { StatusIcon } from "@/components/kanban/status-icon";
import { ApiError } from "@/lib/api";
import { BrainstormEventsProvider } from "@/lib/brainstorm-events-context";
import { orchestrator } from "@/lib/server/api";
import type { TaskStatus } from "@pi-harness/shared";

// Task statuses where the brainstorm phase is over. Mirrors the set used by
// the ApprovalGate so the page header and gate stay in agreement: once the
// task has moved on, neither should claim brainstorm is "in progress".
const PAST_BRAINSTORM: ReadonlySet<TaskStatus> = new Set([
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
]);

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
  const brainstormRunId =
    [...runs].reverse().find((r) => r.phase === "brainstorm")?.id ?? null;

  // task.status is the source of truth: once it advances past brainstorming,
  // the gate value (which captures the brainstorm sub-state) becomes stale
  // for header purposes — render "approved" rather than "awaiting approval"
  // or "in progress", so the page-level signal matches the ApprovalGate
  // footer instead of contradicting it.
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
  const iconKind = past
    ? "done"
    : failed
      ? "blocked"
      : notStarted
        ? "intake"
        : ready
          ? "review"
          : "progress";

  return (
    <>
      <Topbar runningCount={1} blockedCount={1} doneTodayCount={12} branch="main" />

      <BrainstormEventsProvider runId={brainstormRunId}>
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
      </BrainstormEventsProvider>
    </>
  );
}
