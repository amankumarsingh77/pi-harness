import type { Task, TaskStatus } from "@pi-harness/shared";
import { clsx } from "clsx";
import { useDroppable } from "@dnd-kit/react";
import { TaskCard } from "./card";
import type { KanbanDndData } from "./drag-types";
import { columnDropId } from "./drag-types";
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
  activeDragTaskId,
  pendingTaskId,
  humanInterventionTasks,
}: {
  status: TaskStatus;
  tasks: Task[];
  count: number;
  activeDragTaskId: string | null;
  pendingTaskId: string | null;
  humanInterventionTasks: ReadonlySet<string>;
}) {
  const kind = statusKindFor(status);
  const headerLive = LIVE_STATUSES.has(status) && tasks.length > 0;
  const acceptsBacklogDrop = status === "brainstorming";
  const hasDraggedTask = activeDragTaskId !== null;
  const dropActive = acceptsBacklogDrop && hasDraggedTask;
  const { isDropTarget, ref } = useDroppable<KanbanDndData>({
    id: columnDropId(status),
    data: { kind: "column", status },
    disabled: !acceptsBacklogDrop || !hasDraggedTask || pendingTaskId !== null,
  });

  return (
    <section
      ref={ref}
      data-testid={`kanban-column-${status}`}
      className="group flex min-w-0 flex-col"
    >
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
      <div
        className={clsx(
          "flex flex-col gap-1 rounded-md pb-2 transition-colors",
          dropActive && "bg-white/4 outline outline-st-progress",
          isDropTarget && "bg-white/6",
        )}
      >
        {dropActive && (
          <div
            className={clsx(
              "flex h-10 items-center justify-center rounded-md border border-dashed border-st-progress font-mono text-[11.5px] text-st-progress",
              isDropTarget && "bg-white/[0.035]",
            )}
          >
            drop to start brainstorm
          </div>
        )}
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            pending={pendingTaskId === t.id}
            requiresHumanIntervention={humanInterventionTasks.has(t.id)}
          />
        ))}
        {tasks.length === 0 && status === "backlog" && (
          <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-line text-[11.5px] text-fg-faint">
            drop here · or ⌘N
          </div>
        )}
        {tasks.length === 0 && status !== "backlog" && !dropActive && (
          <div
            className={clsx(
              "flex h-10 items-center justify-center rounded-md border border-dashed border-line text-[11.5px] text-fg-faint",
              isDropTarget && "border-st-progress text-st-progress",
            )}
          >
            empty
          </div>
        )}
        {tasks.length > 0 && status === "backlog" && (
          <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-line text-[11.5px] text-fg-faint">
            drop here · or ⌘N
          </div>
        )}
      </div>
    </section>
  );
}
