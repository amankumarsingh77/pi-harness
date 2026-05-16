"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import {
  PHASES,
  TASK_PRIORITIES,
  THINKING_LEVELS,
  type Phase,
  type PhaseModelConfig,
  type TaskPriority,
  type ThinkingLevel,
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

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");
  const phaseModels = parsePhaseModels(formData.get("phaseModels"));
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

function parsePhaseModels(
  value: FormDataEntryValue | null,
): Partial<Record<Phase, PhaseModelConfig>> | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsedJson: unknown = JSON.parse(value);
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    throw new Error("invalid phase models");
  }

  const phaseModels: Partial<Record<Phase, PhaseModelConfig>> = {};
  for (const [phase, config] of Object.entries(parsedJson)) {
    if (!isPhase(phase) || !isPhaseModelConfig(config)) {
      throw new Error("invalid phase models");
    }
    phaseModels[phase] = config;
  }
  return phaseModels;
}

function isPhase(value: string): value is Phase {
  return PHASES.some((phase) => phase === value);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level === value);
}

function isPhaseModelConfig(value: unknown): value is PhaseModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config["provider"] === "string" &&
    config["provider"].length > 0 &&
    typeof config["model"] === "string" &&
    config["model"].length > 0 &&
    typeof config["thinkingLevel"] === "string" &&
    isThinkingLevel(config["thinkingLevel"])
  );
}
