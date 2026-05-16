import type { TaskStatus } from "@pi-harness/shared";

export const BRAINSTORM_DROP_ID = "column:brainstorming";

export type TaskDragData = {
  readonly kind: "task";
  readonly taskId: string;
  readonly status: TaskStatus;
};

export type ColumnDropData = {
  readonly kind: "column";
  readonly status: TaskStatus;
};

export type KanbanDndData = TaskDragData | ColumnDropData;

export function taskDragId(taskId: string): string {
  return `task:${taskId}`;
}

export function columnDropId(status: TaskStatus): string {
  return `column:${status}`;
}

export function isTaskDragData(value: unknown): value is TaskDragData {
  if (!isRecord(value)) return false;
  return value["kind"] === "task" && typeof value["taskId"] === "string";
}

export function isColumnDropData(value: unknown): value is ColumnDropData {
  if (!isRecord(value)) return false;
  return value["kind"] === "column" && typeof value["status"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
