"use client";

import type { Task, TaskPriority, TaskStatus, Workflow } from "@pi-harness/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { SlidersHorizontal } from "lucide-react";
import { mutations } from "@/lib/client/queries";
import { KanbanColumn } from "./column";
import {
  columnDropId,
  isColumnDropData,
  isTaskDragData,
  taskDragId,
} from "./drag-types";
import type { BoardTransition, BoardTransitionAction } from "./transition-types";

export type BoardFilters = {
  workflow?: Workflow;
  priority?: Exclude<TaskPriority, "none" | "low">;
};

const COLUMN_ORDER: TaskStatus[] = [
  "backlog",
  "brainstorming",
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
];

// Phase-scoped failure sub-statuses are *modes*, not their own columns. Render
// them under the original phase column with a red-border card (see card.tsx),
// so a brainstorm that errored stays visible on the brainstorm surface for
// triage. verification_failed remains its own column — it's a distinct triage
// state with retry-cap semantics.
const BUCKET: Partial<Record<TaskStatus, TaskStatus>> = {
  brainstorm_failed: "brainstorming",
  plan_failed: "planning",
  code_failed: "executing",
  pr_failed: "ready_to_ship",
};

function bucketStatus(status: TaskStatus): TaskStatus {
  return BUCKET[status] ?? status;
}

export function KanbanBoard({
  tasks,
  counts: _counts,
  onTransition,
  initialFilters = {},
  humanInterventionTaskIds = [],
}: {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
  onTransition?: BoardTransition;
  initialFilters?: BoardFilters;
  humanInterventionTaskIds?: readonly string[];
}) {
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const pendingTaskIdRef = useRef<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(initialFilters);
  const transitionTask = onTransition ?? createDefaultTransition();
  const visibleTasks = useMemo(() => filterTasks(tasks, filters), [tasks, filters]);
  const humanInterventionTasks = useMemo(
    () => new Set(humanInterventionTaskIds),
    [humanInterventionTaskIds],
  );
  const activeDragTask = useMemo(
    () => visibleTasks.find((task) => task.id === activeDragTaskId) ?? null,
    [activeDragTaskId, visibleTasks],
  );
  const staleCount = useMemo(() => countStaleTasks(tasks, Date.now()), [tasks]);
  const hasFilters = filters.workflow !== undefined || filters.priority !== undefined;

  const byStatus: Record<string, Task[]> = {};
  for (const t of visibleTasks) (byStatus[bucketStatus(t.status)] ??= []).push(t);
  const bucketedCounts: Partial<Record<TaskStatus, number>> = {};
  if (hasFilters) {
    for (const task of visibleTasks) {
      const target = bucketStatus(task.status);
      bucketedCounts[target] = (bucketedCounts[target] ?? 0) + 1;
    }
  } else {
    for (const [status, n] of Object.entries(_counts) as [TaskStatus, number][]) {
      const target = bucketStatus(status);
      bucketedCounts[target] = (bucketedCounts[target] ?? 0) + n;
    }
  }

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.operation.source?.data;
    setActiveDragTaskId(isTaskDragData(data) && data.status === "backlog" ? data.taskId : null);
  };

  const startBrainstormFromBoard = useCallback(async (taskId: string): Promise<void> => {
    if (pendingTaskIdRef.current !== null) return;
    pendingTaskIdRef.current = taskId;
    setPendingTaskId(taskId);
    try {
      await transitionTask(taskId, START_BRAINSTORM);
    } finally {
      pendingTaskIdRef.current = null;
      setPendingTaskId(null);
    }
  }, [transitionTask]);

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    setActiveDragTaskId(null);
    const source = event.operation.source?.data;
    const target = event.operation.target?.data;
    if (event.canceled || !isTaskDragData(source) || !isColumnDropData(target)) return;
    if (activeDragTaskId !== source.taskId || target.status !== "brainstorming") return;
    await startBrainstormFromBoard(source.taskId);
  };

  return (
    <main className="relative">
      <BoardToolbar
        filters={filters}
        staleCount={staleCount}
        onPriorityFilter={(priority) => setFilters((curr) => ({ ...curr, priority }))}
        onWorkflowFilter={(workflow) => setFilters((curr) => ({ ...curr, workflow }))}
        onClearFilters={() => setFilters({})}
        onRemoveWorkflow={() => setFilters((curr) => withoutWorkflow(curr))}
        onRemovePriority={() => setFilters((curr) => withoutPriority(curr))}
      />
      <DragDropProvider
        onDragStart={handleDragStart}
        onDragEnd={(event) => {
          void handleDragEnd(event);
        }}
      >
        <div className="no-scrollbar overflow-x-auto px-5 pb-20 pt-3" aria-label="Task board columns">
          <div
            className="grid min-w-max gap-3"
            style={{
              gridTemplateColumns: `repeat(${COLUMN_ORDER.length}, minmax(280px, 1fr))`,
            }}
          >
            {COLUMN_ORDER.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                tasks={byStatus[status] ?? []}
                count={bucketedCounts[status] ?? 0}
                activeDragTaskId={activeDragTaskId}
                pendingTaskId={pendingTaskId}
                humanInterventionTasks={humanInterventionTasks}
                onStartBrainstorm={startBrainstormFromBoard}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeDragTask && <TaskDragPreview task={activeDragTask} />}
        </DragOverlay>
      </DragDropProvider>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[38px] left-0 w-8 bg-gradient-to-r from-bg to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[38px] right-0 w-12 bg-gradient-to-l from-bg to-transparent"
      />
    </main>
  );
}

function TaskDragPreview({ task }: { readonly task: Task }) {
  return (
    <div
      aria-hidden="true"
      className="w-[260px] rounded-md border border-line-hover bg-card px-3 py-2.5 text-[13px] font-medium leading-[1.4] text-fg"
      data-drag-id={taskDragId(task.id)}
      data-drop-id={columnDropId("brainstorming")}
    >
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] text-fg-mute">
        <span>T-{task.id.slice(0, 4).toUpperCase()}</span>
        <span className="ml-auto">to Brainstorming</span>
      </div>
      <div className="line-clamp-2 [line-clamp:2]">{task.title}</div>
    </div>
  );
}

const START_BRAINSTORM: BoardTransitionAction = {
  type: "user_start_brainstorm",
  workflow: "backend-feature",
};

function BoardToolbar({
  filters,
  staleCount,
  onPriorityFilter,
  onWorkflowFilter,
  onClearFilters,
  onRemoveWorkflow,
  onRemovePriority,
}: {
  filters: BoardFilters;
  staleCount: number;
  onPriorityFilter: (priority: Exclude<TaskPriority, "none" | "low">) => void;
  onWorkflowFilter: (workflow: Workflow) => void;
  onClearFilters: () => void;
  onRemoveWorkflow: () => void;
  onRemovePriority: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Board controls"
      className="flex h-[38px] items-center gap-2 border-b border-line px-4 text-[12px] text-fg-mute sm:px-5"
    >
      <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-line font-mono text-[11px]">
        <button
          type="button"
          aria-pressed="true"
          className="h-6 border-r border-line bg-white/[0.035] px-2.5 text-fg-body"
        >
          Board
        </button>
        <button
          type="button"
          disabled
          title="List view is coming soon"
          className="h-6 cursor-not-allowed border-r border-line px-2.5 text-fg-faint opacity-55"
        >
          List
        </button>
        <button
          type="button"
          disabled
          title="Calendar view is coming soon"
          className="h-6 cursor-not-allowed px-2.5 text-fg-faint opacity-55"
        >
          Calendar
        </button>
      </div>

      {filters.workflow && (
        <FilterPill label={`workflow: ${filters.workflow}`} onRemove={onRemoveWorkflow} removeLabel="Remove workflow filter" />
      )}
      {filters.priority && (
        <FilterPill label={`priority ≥ ${filters.priority}`} onRemove={onRemovePriority} removeLabel="Remove priority filter" />
      )}

      <BoardFilterMenu
        filters={filters}
        onPriority={onPriorityFilter}
        onWorkflow={onWorkflowFilter}
        onClear={onClearFilters}
      />

      <span className="ml-auto hidden items-center gap-2 font-mono text-[11px] text-fg-subtle sm:inline-flex">
        <span>{staleCount} cards idle &gt; 30m</span>
        <span className="text-fg-faint">·</span>
        <span>scroll for all phases</span>
      </span>
    </div>
  );
}

function BoardFilterMenu({
  filters,
  onPriority,
  onWorkflow,
  onClear,
}: {
  readonly filters: BoardFilters;
  readonly onPriority: (priority: Exclude<TaskPriority, "none" | "low">) => void;
  readonly onWorkflow: (workflow: Workflow) => void;
  readonly onClear: () => void;
}) {
  const active = filters.workflow !== undefined || filters.priority !== undefined;

  return (
    <details className="relative">
      <summary className="flex h-6 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal size={11} strokeWidth={1.9} aria-hidden="true" />
        filter
        {active && <span className="text-st-progress">on</span>}
      </summary>
      <div className="absolute left-0 top-7 z-30 w-56 rounded-md border border-line bg-card p-2 shadow-[0_18px_44px_rgba(0,0,0,0.34)]">
        <div className="px-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-faint">
          Priority
        </div>
        <FilterOption label="Urgent and up" onClick={() => onPriority("urgent")} />
        <FilterOption label="High and up" onClick={() => onPriority("high")} />
        <FilterOption label="Medium and up" onClick={() => onPriority("medium")} />
        <div className="mt-2 px-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-faint">
          Workflow
        </div>
        <FilterOption label="Backend feature" onClick={() => onWorkflow("backend-feature")} />
        <button
          type="button"
          className="mt-2 h-7 w-full rounded border border-line px-2 text-left font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body"
          onClick={onClear}
        >
          Clear filters
        </button>
      </div>
    </details>
  );
}

function FilterOption({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="block h-7 w-full rounded px-1.5 text-left text-[12px] text-fg-body transition-colors hover:bg-card-hover"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function FilterPill({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 font-mono text-[11px] text-fg-body">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        className="text-fg-faint transition-colors hover:text-fg"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

function filterTasks(tasks: readonly Task[], filters: BoardFilters): Task[] {
  return tasks.filter((task) => {
    if (filters.workflow && task.workflow !== filters.workflow) return false;
    if (filters.priority && priorityScore(task.priority) < priorityScore(filters.priority)) return false;
    return true;
  });
}

function priorityScore(priority: TaskPriority): number {
  switch (priority) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    case "none":
      return 0;
  }
}

function countStaleTasks(tasks: readonly Task[], nowMs: number): number {
  const cutoff = nowMs - 30 * 60 * 1000;
  return tasks.filter((task) => {
    if (task.status === "done" || task.status === "cancelled") return false;
    return new Date(task.updatedAt).getTime() < cutoff;
  }).length;
}

function withoutWorkflow(filters: BoardFilters): BoardFilters {
  const { workflow: _workflow, ...rest } = filters;
  return rest;
}

function withoutPriority(filters: BoardFilters): BoardFilters {
  const { priority: _priority, ...rest } = filters;
  return rest;
}

function createDefaultTransition(): BoardTransition {
  return async (taskId, action) => {
    await mutations.transitionTask(taskId).mutationFn(action);
    window.location.reload();
  };
}
