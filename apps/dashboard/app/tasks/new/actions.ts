"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { TASK_PRIORITIES, type TaskPriority } from "@pi-harness/shared";
import { orchestrator } from "@/lib/server/api";

function isTaskPriority(value: string): value is TaskPriority {
  return TASK_PRIORITIES.some((priority) => priority === value);
}

function priorityFromForm(value: FormDataEntryValue | null): TaskPriority {
  return typeof value === "string" && isTaskPriority(value) ? value : "none";
}

function tagsFromForm(formData: FormData): string[] {
  return formData
    .getAll("tags")
    .filter((value): value is string => typeof value === "string");
}

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");
  const task = await orchestrator.createTask({
    title,
    description: String(formData.get("description") ?? ""),
    priority: priorityFromForm(formData.get("priority")),
    tags: tagsFromForm(formData),
  });
  revalidatePath("/");
  redirect(`/tasks/${task.id}` as Route);
}
