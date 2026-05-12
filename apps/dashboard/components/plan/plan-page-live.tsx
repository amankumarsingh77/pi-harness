"use client";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { StatusIcon } from "@/components/kanban/status-icon";
import { PlanBody } from "@/components/plan/plan-body";
import { PlanApprovalGate } from "@/components/plan/approval-gate";
import { queries } from "@/lib/client/queries";
import type { PlanBundle } from "@/lib/api";

export function PlanPageLive({
  taskId,
  initialTask,
  initialBundle,
}: {
  taskId: string;
  initialTask: { task: Task; runs: import("@pi-harness/shared").Run[] };
  initialBundle: PlanBundle;
}) {
  const taskQuery = useQuery({ ...queries.getTask(taskId), initialData: initialTask });
  const bundleQuery = useQuery({ ...queries.getPlanBundle(taskId), initialData: initialBundle });
  const { task, runs } = taskQuery.data;
  const bundle = bundleQuery.data;
  const planRunId = [...runs].reverse().find((run) => run.phase === "plan")?.id ?? null;
  const past = ["executing", "verifying", "verification_failed", "ready_to_ship", "done"]
    .includes(task.status);
  const failed = task.status === "plan_failed";
  const ready = !past && !failed && bundle.gate === "awaiting_user";
  const headerStatus = past
    ? "approved"
    : failed
      ? "failed — restart to retry"
      : ready
        ? "awaiting your approval"
        : task.status === "planning"
          ? "in progress"
          : "not started";
  const iconKind = past ? "done" : failed ? "blocked" : ready ? "review" : task.status === "planning" ? "progress" : "intake";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Topbar runningCount={task.status === "planning" ? 1 : 0} blockedCount={failed ? 1 : 0} doneTodayCount={0} branch="main" />
      <section className="border-b border-line px-6 pb-3.5 pt-4">
        <nav className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
          <Link href="/" className="text-fg-mute hover:text-fg-body">← Board</Link>
          <span className="text-fg-faint">/</span>
          <Link href={`/tasks/${task.id}` as never} className="text-fg-body hover:text-fg">
            {task.id}
          </Link>
          <span className="text-fg-faint">/</span>
          <span className="text-st-review">plan</span>
        </nav>
        <div className="flex items-center gap-3">
          <StatusIcon kind={iconKind} size={16} />
          <h1 className="m-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.018em] text-fg">
            {task.title}
          </h1>
          <span className="font-mono text-[11.5px] text-fg-mute">{headerStatus}</span>
        </div>
      </section>

      <PlanBody
        research={bundle.research}
        events={bundle.events}
        plannerLogDefaultOpen={task.status === "planning"}
        artifactsBody={
          <>
            <article className="scroll-hide overflow-y-auto border-r border-line px-7 py-5.5">
              <SectionHeading num="01" title="plan.md" status={bundle.plan?.fm.status ?? null} />
              {bundle.plan ? (
                <div className="markdown-body text-[13.5px] leading-[1.65] text-fg-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{bundle.plan.body.trim()}</ReactMarkdown>
                </div>
              ) : (
                <EmptyState text="plan.md hasn't been authored yet — preflight is still running" />
              )}
            </article>
            <aside className="scroll-hide overflow-y-auto px-7 py-5.5">
              <SectionHeading num="02" title="scenarios.yaml" status={bundle.scenarios?.fm.status ?? null} />
              {bundle.scenarios ? (
                <pre className="scroll-hide overflow-x-auto rounded border border-line bg-bg p-3 font-mono text-[12px] leading-[1.55] text-fg-body">
                  {bundle.scenarios.body.trim()}
                </pre>
              ) : (
                <EmptyState text="scenarios.yaml hasn't been authored yet" />
              )}
            </aside>
          </>
        }
      />
      <PlanApprovalGate taskId={task.id} gate={bundle.gate} taskStatus={task.status} />
    </div>
  );
}

function SectionHeading({ num, title, status }: { num: string; title: string; status: string | null }) {
  return (
    <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
      <span className="font-mono text-[10.5px] text-fg-faint">{num}</span>
      <h2 className="m-0 text-[13px] font-semibold tracking-[-0.005em] text-fg">{title}</h2>
      {status && (
        <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
          status: <span className="text-fg-body">{status}</span>
        </span>
      )}
    </header>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-[12.5px] italic text-fg-mute">{text}</p>;
}
