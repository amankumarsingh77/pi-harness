"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import {
  PHASES,
  TASK_PRIORITIES,
  type Phase,
  type PhaseModelConfig,
  type TaskPriority,
} from "@pi-harness/shared";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function phaseModelsFromForm(
  formData: FormData,
): Partial<Record<Phase, Partial<PhaseModelConfig>>> | undefined {
  const raw = formData.get("phaseModels");
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const phaseModels: Partial<Record<Phase, Partial<PhaseModelConfig>>> = {};
  for (const phase of PHASES) {
    const value = parsed[phase];
    if (!isRecord(value)) continue;
    const provider = typeof value["provider"] === "string" ? value["provider"].trim() : "";
    const model = typeof value["model"] === "string" ? value["model"].trim() : "";
    if (provider.length > 0 && model.length > 0) {
      phaseModels[phase] = { provider, model };
    }
  }

  return Object.keys(phaseModels).length > 0 ? phaseModels : undefined;
}

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");
  const phaseModels = phaseModelsFromForm(formData);
  const task = await orchestrator.createTask({
    title,
    description: String(formData.get("description") ?? ""),
    priority: priorityFromForm(formData.get("priority")),
    tags: tagsFromForm(formData),
    ...(phaseModels !== undefined ? { phaseModels } : {}),
  });
  revalidatePath("/");
  redirect(`/tasks/${task.id}` as Route);
}
