import type { Task, TaskStatus } from "@pi-harness/shared";
import { KanbanColumn } from "./column";

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
}: {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
}) {
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
