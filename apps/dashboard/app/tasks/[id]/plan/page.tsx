import Link from "next/link";
import type { Metadata, Route } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · plan · pi-harness` };
}
import { Topbar } from "@/components/topbar";
import { PlanPreview } from "@/components/plan/plan-preview";
import { ScenarioEditor } from "@/components/plan/scenario-editor";
import { StatusIcon } from "@/components/kanban/status-icon";
import { MOCK_PLAN } from "@/lib/server/_fixtures/task-detail";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: _id } = await params;
  const plan = MOCK_PLAN;

  return (
    <>
      <Topbar runningCount={3} blockedCount={1} doneTodayCount={12} branch="main" />

      <section className="border-b border-line px-6 pb-3.5 pt-4">
        <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
          <Link href={"/" as Route} className="text-fg-mute transition-colors hover:text-fg-body">
            <span className="mr-1 inline-block align-[-1px]">
              <BackArrow />
            </span>
            Board
          </Link>
          <span className="text-fg-ghost">/</span>
          <Link
            href={`/tasks/${plan.taskId}` as Route}
            className="text-fg-body transition-colors hover:text-fg"
          >
            {plan.taskId}
          </Link>
          <span className="text-fg-ghost">/</span>
          <span className="text-st-done">plan</span>
        </div>

        <div className="flex items-center gap-3">
          <StatusIcon kind="done" size={16} />
          <h1 className="m-0 flex-1 font-display text-[17px] font-semibold tracking-[-0.018em] text-fg">
            {plan.taskTitle}
          </h1>
          <span className="font-mono text-[11.5px] text-fg-mute">
            phase complete · <span className="text-fg-body">{plan.phaseDurationLabel}</span> ·{" "}
            {plan.authoredBy}
          </span>
          <div className="flex gap-1.5">
            <HeadButton>Open plan.md</HeadButton>
            <HeadButton>Re-run plan</HeadButton>
          </div>
        </div>
      </section>

      <div className="grid min-h-[calc(100vh-48px-64px-56px)] grid-cols-[1.4fr_1fr]">
        <main className="overflow-auto border-r border-line">
          <PlanPreview plan={plan} />
        </main>
        <ScenarioEditor scenarios={plan.scenarios} />
      </div>

      <GateStrip plan={plan} />
    </>
  );
}

function HeadButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded border border-line bg-transparent px-2.5 py-1 text-[12px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
    >
      {children}
    </button>
  );
}

function GateStrip({ plan }: { plan: typeof MOCK_PLAN }) {
  if (plan.gate.state !== "approved") return null;
  const g = plan.gate;
  return (
    <section className="sticky bottom-0 flex items-center gap-4 border-t border-line bg-card px-6 py-3 backdrop-blur-md">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-st-done/[0.12] text-st-done shadow-[inset_0_0_0_1px_rgba(76,183,130,0.3)]">
        <StatusIcon kind="done" size={14} />
      </span>
      <div className="flex-1 leading-[1.45]">
        <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
          Plan approved · auto-advanced to Code
        </div>
        <div className="mt-0.5 font-mono text-[11.5px] text-fg-mute">
          <span className="text-fg-body">
            {g.enabledCount} of {g.totalCount}
          </span>{" "}
          scenarios enabled · all must pass before PR · coder picked up plan rev{" "}
          <span className="text-fg-body">{g.planRev}</span> at {g.coderPickedUpAt}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="cursor-pointer rounded-md border border-line bg-transparent px-3 py-1.5 text-[12px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
        >
          Diff vs previous plan
        </button>
        <Link
          href={`/tasks/${plan.taskId}` as Route}
          className="cursor-pointer rounded-md bg-st-progress px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-110"
        >
          Open Code phase ↗
        </Link>
      </div>
    </section>
  );
}

function BackArrow() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M 9 6 L 3 6 M 6 3 L 3 6 L 6 9"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
