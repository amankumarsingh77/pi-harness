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

export function KanbanBoard({
  tasks,
  counts,
}: {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
}) {
  const byStatus: Record<string, Task[]> = {};
  for (const t of tasks) (byStatus[t.status] ??= []).push(t);

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
              count={counts[status] ?? 0}
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
