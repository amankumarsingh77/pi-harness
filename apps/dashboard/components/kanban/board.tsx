"use client";

import type { Task, TaskPriority, TaskStatus, Workflow } from "@pi-harness/shared";
import { useMemo, useState } from "react";
import type { Api } from "@/lib/api";
import { mutations } from "@/lib/client/queries";
import { KanbanColumn } from "./column";

export type BoardTransitionAction = Parameters<Api["transitionTask"]>[1];
export type BoardTransition = (
  taskId: string,
  action: BoardTransitionAction,
) => Promise<void>;

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
}: {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
  onTransition?: BoardTransition;
  initialFilters?: BoardFilters;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(initialFilters);
  const transitionTask = onTransition ?? createDefaultTransition();
  const visibleTasks = useMemo(() => filterTasks(tasks, filters), [tasks, filters]);
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

  return (
    <main className="relative">
      <BoardToolbar
        filters={filters}
        staleCount={staleCount}
        onRemoveWorkflow={() => setFilters((curr) => withoutWorkflow(curr))}
        onRemovePriority={() => setFilters((curr) => withoutPriority(curr))}
      />
      <div className="no-scrollbar overflow-x-auto px-5 pb-20 pt-3">
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
              draggedTaskId={draggedTaskId}
              pendingTaskId={pendingTaskId}
              onDragStart={setDraggedTaskId}
              onDragEnd={() => setDraggedTaskId(null)}
              onTransition={async (taskId, action) => {
                setPendingTaskId(taskId);
                try {
                  await transitionTask(taskId, action);
                } finally {
                  setPendingTaskId(null);
                  setDraggedTaskId(null);
                }
              }}
            />
          ))}
        </div>
      </div>
      {/* Right-edge fade hints there's more content beyond the viewport. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg to-transparent"
      />
    </main>
  );
}

function BoardToolbar({
  filters,
  staleCount,
  onRemoveWorkflow,
  onRemovePriority,
}: {
  filters: BoardFilters;
  staleCount: number;
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
          className="h-6 border-r border-line px-2.5 text-fg-body"
        >
          Board
        </button>
        <button type="button" disabled className="h-6 border-r border-line px-2.5 text-fg-faint">
          List
        </button>
        <button type="button" disabled className="h-6 px-2.5 text-fg-faint">
          Calendar
        </button>
      </div>

      {filters.workflow && (
        <FilterPill label={`workflow: ${filters.workflow}`} onRemove={onRemoveWorkflow} removeLabel="Remove workflow filter" />
      )}
      {filters.priority && (
        <FilterPill label={`priority ≥ ${filters.priority}`} onRemove={onRemovePriority} removeLabel="Remove priority filter" />
      )}

      <button
        type="button"
        className="h-6 shrink-0 rounded-md border border-line px-2.5 font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body"
      >
        + filter
      </button>

      <span className="ml-auto hidden font-mono text-[11px] text-fg-subtle sm:inline">
        {staleCount} cards idle &gt; 30m · auto-cleanup ok
      </span>
    </div>
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
