import type { Task, TaskStatus } from "@pi-harness/shared";
import { TaskCard } from "./card";
import { StatusIcon, statusKindFor } from "./status-icon";

// Failed sub-statuses (brainstorm_failed, plan_failed, code_failed, pr_failed)
// are bucketed under their parent phase by `board.tsx` and never render as a
// column header on their own. The titles are required for type-exhaustiveness
// and act as a defensive fallback if a future caller forgets to bucket — they
// reuse the parent phase title so the header still reads sensibly.
const TITLES: Record<TaskStatus, string> = {
  backlog: "Backlog",
  brainstorming: "Brainstorming",
  brainstorm_failed: "Brainstorming",
  planning: "Planning",
  plan_failed: "Planning",
  executing: "Code",
  code_failed: "Code",
  verifying: "Verifying",
  verification_failed: "Verify Failed",
  ready_to_ship: "Ready to Ship",
  pr_failed: "Ready to Ship",
  done: "Done",
  cancelled: "Cancelled",
};

const LIVE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "brainstorming",
  "planning",
  "executing",
  "verifying",
]);

export function KanbanColumn({
  status,
  tasks,
  count,
}: {
  status: TaskStatus;
  tasks: Task[];
  count: number;
}) {
  const kind = statusKindFor(status);
  const headerLive = LIVE_STATUSES.has(status) && tasks.length > 0;
  return (
    <section className="group flex min-w-0 flex-col">
      <header className="flex h-10 items-center gap-2 px-1.5 text-[12px] font-medium text-fg-mute">
        <StatusIcon kind={kind} live={headerLive} />
        <span className="text-fg-body">{TITLES[status]}</span>
        <span className="ml-0.5 font-mono text-[11px] text-fg-faint">{count}</span>
        <span
          className="ml-auto inline-flex h-[22px] w-[22px] items-center justify-center rounded text-fg-faint opacity-0 transition-opacity duration-150 hover:bg-white/5 hover:text-fg group-hover:opacity-100"
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M 8 3.5 L 8 12.5 M 3.5 8 L 12.5 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </span>
      </header>
      <div className="flex flex-col gap-1 pb-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
        {tasks.length === 0 && (
          <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-line text-[11.5px] text-fg-faint">
            empty
          </div>
        )}
      </div>
    </section>
  );
}
