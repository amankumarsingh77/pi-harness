import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { ChatPanel } from "@/components/brainstorm/chat-panel";
import { ArtifactPane } from "@/components/brainstorm/emerging-spec";
import { ApprovalGate } from "@/components/brainstorm/approval-gate";
import { StatusIcon } from "@/components/kanban/status-icon";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

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

  const ready = bundle.awaitingApproval;
  const headerStatus = ready ? "awaiting your approval" : "in progress";

  return (
    <>
      <Topbar runningCount={1} blockedCount={1} doneTodayCount={12} branch="main" />

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
          <StatusIcon kind={ready ? "review" : "progress"} size={16} />
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
        </div>
      </section>

      <main className="grid h-[calc(100vh-48px-80px)] min-h-0 grid-cols-[1.4fr_1fr]">
        <ChatPanel
          taskId={task.id}
          runId={brainstormRunId}
          initialEvents={bundle.events}
          awaitingApproval={bundle.awaitingApproval}
        />

        <aside className="flex min-h-0 flex-col bg-bg">
          <ArtifactPane design={bundle.design} spec={bundle.spec} />
          <ApprovalGate
            taskId={task.id}
            awaitingApproval={bundle.awaitingApproval}
            taskStatus={task.status}
          />
        </aside>
      </main>
    </>
  );
}
