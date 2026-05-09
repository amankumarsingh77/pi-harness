"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { orchestrator } from "@/lib/server/api";

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");
  // priority + tags are collected by the form but not yet on the orchestrator
  // Api — they'll wire up when the shared Task type gains those fields.
  const task = await orchestrator.createTask({
    title,
    description: String(formData.get("description") ?? ""),
  });
  revalidatePath("/");
  redirect(`/tasks/${task.id}` as Route);
}
