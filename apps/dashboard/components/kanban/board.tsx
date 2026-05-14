"use client";

import type { Task, TaskStatus } from "@pi-harness/shared";
import { useState } from "react";
import type { Api } from "@/lib/api";
import { mutations } from "@/lib/client/queries";
import { KanbanColumn } from "./column";

export type BoardTransitionAction = Parameters<Api["transitionTask"]>[1];
export type BoardTransition = (
  taskId: string,
  action: BoardTransitionAction,
) => Promise<void>;

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
  counts,
  onTransition,
}: {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
  onTransition?: BoardTransition;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const transitionTask = onTransition ?? createDefaultTransition();

  const byStatus: Record<string, Task[]> = {};
  for (const t of tasks) (byStatus[bucketStatus(t.status)] ??= []).push(t);
  // Fold counts the same way the tasks are bucketed so the column header
  // count matches the rendered card count.
  const bucketedCounts: Partial<Record<TaskStatus, number>> = {};
  for (const [status, n] of Object.entries(counts) as [TaskStatus, number][]) {
    const target = bucketStatus(status);
    bucketedCounts[target] = (bucketedCounts[target] ?? 0) + n;
  }

  return (
    <main className="relative">
      <div className="no-scrollbar overflow-x-auto px-5 pb-20 pt-4">
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

function createDefaultTransition(): BoardTransition {
  return async (taskId, action) => {
    await mutations.transitionTask(taskId).mutationFn(action);
    window.location.reload();
  };
}
