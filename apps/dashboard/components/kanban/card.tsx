import Link from "next/link";
import type { Route } from "next";
import type { Task } from "@pi-harness/shared";
import { clsx } from "clsx";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { PointerSensor, useDraggable } from "@dnd-kit/react";
import { Play } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { formatRelativeCompact } from "@/lib/format";
import type { KanbanDndData } from "./drag-types";
import { taskDragId } from "./drag-types";

const POINTER_DRAG_SENSORS = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 6 }),
    ],
  }),
];

const LIVE_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "brainstorming",
  "planning",
  "executing",
  "verifying",
]);

const FAILED_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "brainstorm_failed",
  "plan_failed",
  "code_failed",
  "pr_failed",
  "verification_failed",
]);

export function TaskCard({
  task,
  pending,
  requiresHumanIntervention,
  onStartBrainstorm,
}: {
  task: Task;
  pending: boolean;
  requiresHumanIntervention: boolean;
  onStartBrainstorm: (taskId: string) => Promise<void>;
}) {
  const age = formatRelativeCompact(task.updatedAt ?? task.createdAt);
  const draggable = task.status === "backlog";
  const stripe = stripeFor(task, requiresHumanIntervention);
  const priority = priorityGlyph(task);
  const subMeta = subMetaFor(task);
  const { handleRef, isDragging, ref } = useDraggable<KanbanDndData>({
    id: taskDragId(task.id),
    data: { kind: "task", taskId: task.id, status: task.status },
    disabled: !draggable || pending,
    ...(draggable ? { sensors: POINTER_DRAG_SENSORS } : {}),
  });
  const setDragRefs = useCallback(
    (element: HTMLElement | null) => {
      ref(element);
      handleRef(draggable ? element : null);
    },
    [draggable, handleRef, ref],
  );
  const suppressOpenAfterDragRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      suppressOpenAfterDragRef.current = true;
      return undefined;
    }
    if (!suppressOpenAfterDragRef.current) return undefined;

    const timeout = window.setTimeout(() => {
      suppressOpenAfterDragRef.current = false;
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [isDragging]);
  const handleOpenTask = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!suppressOpenAfterDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressOpenAfterDragRef.current = false;
  }, []);
  const handleStartBrainstorm = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void onStartBrainstorm(task.id);
    },
    [onStartBrainstorm, task.id],
  );

  return (
    <div
      data-testid={`task-card-${task.id}`}
      className="relative"
    >
      <article
        ref={setDragRefs}
        className={clsx(
          "group relative overflow-hidden rounded-md border border-line bg-card px-3 py-2.5 pl-3.5",
          "transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-hover hover:bg-card-hover hover:shadow-[0_10px_26px_rgba(0,0,0,0.18)]",
          draggable && !pending && "cursor-grab active:cursor-grabbing",
          (pending || isDragging) && "opacity-60",
        )}
        title={task.title}
      >
        {stripe && (
          <span
            data-testid={`task-card-stripe-${task.id}`}
            className="absolute inset-y-0 left-0 w-0.5"
            style={{ background: stripe }}
            aria-hidden="true"
          />
        )}
        <Link
          href={`/tasks/${task.id}` as Route}
          aria-label={`Open ${task.title}`}
          onClick={handleOpenTask}
          className="absolute inset-0 z-10 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-line-hover"
        />

        <div className="pointer-events-none relative z-20">
          <div className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.01em] text-fg-mute">
            <span className="text-fg-mute">T-{task.id.slice(0, 4).toUpperCase()}</span>
            {priority && (
              <span className={clsx("text-[10px] leading-none", priority.className)}>
                {priority.glyph}
              </span>
            )}
            <span className="ml-auto text-fg-faint">{age}</span>
          </div>

          <div
            className={clsx(
              "mt-2 line-clamp-2 [line-clamp:2] text-[13px] font-medium leading-[1.4]",
              "transition-colors group-hover:text-fg",
              task.status === "done" ? "text-fg-mute" : "text-fg",
            )}
          >
            {task.title}
          </div>

          {subMeta && (
            <div className={clsx("mt-2 flex items-center gap-2", draggable && "pr-16")}>
              <span className="min-w-0 truncate font-mono text-[10.5px] tracking-[0.01em] text-fg-mute">
                {subMeta}
              </span>
            </div>
          )}
        </div>
      </article>

      {draggable && (
        <button
          type="button"
          aria-label={`Start brainstorm for ${task.title}`}
          disabled={pending}
          onClick={handleStartBrainstorm}
          className={clsx(
            "absolute bottom-2.5 right-3 z-30 inline-flex h-6 shrink-0 items-center gap-1 rounded border border-line bg-card px-1.5 font-mono text-[10.5px] text-fg-mute",
            "transition-colors hover:border-line-hover hover:bg-white/[0.045] hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-line-hover",
            pending && "cursor-not-allowed opacity-55",
          )}
          title="Start brainstorm"
        >
          <Play size={11} strokeWidth={2} aria-hidden="true" />
          <span>Start</span>
        </button>
      )}
    </div>
  );
}

function stripeFor(task: Task, requiresHumanIntervention: boolean): string | null {
  if (requiresHumanIntervention) return "var(--color-card-stripe-review)";
  if (FAILED_STATUSES.has(task.status)) return "var(--color-card-stripe-blocked)";
  if (LIVE_STATUSES.has(task.status)) return "var(--color-card-stripe-progress)";
  if (task.status === "ready_to_ship") return "var(--color-card-stripe-shipping)";
  if (task.status === "done") return "var(--color-card-stripe-done)";
  return null;
}

function priorityGlyph(task: Task): { glyph: string; className: string } | null {
  switch (task.priority) {
    case "urgent":
      return { glyph: "▲", className: "text-st-blocked" };
    case "high":
      return { glyph: "◆", className: "text-fg-body" };
    case "medium":
      return { glyph: "◇", className: "text-fg-mute" };
    case "low":
    case "none":
      return null;
  }
}

function subMetaFor(task: Task): string | null {
  if (task.branchName) return task.branchName;
  if (task.status === "backlog") return task.workflow;
  return null;
}
