"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { z } from "zod";
import { PHASES, THINKING_LEVELS } from "@pi-harness/shared";
import { orchestrator } from "@/lib/server/api";

const PhaseModelFormSchema = z.record(
  z.enum(PHASES),
  z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      thinkingLevel: z.enum(THINKING_LEVELS),
    })
    .strict(),
);

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");
  const phaseModels = parsePhaseModels(formData.get("phaseModels"));
  // priority + tags are collected by the form but not yet on the orchestrator
  // Api — they'll wire up when the shared Task type gains those fields.
  const task = await orchestrator.createTask({
    title,
    description: String(formData.get("description") ?? ""),
    ...(phaseModels !== undefined ? { phaseModels } : {}),
  });
  revalidatePath("/");
  redirect(`/tasks/${task.id}` as Route);
}

function parsePhaseModels(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsedJson: unknown = JSON.parse(value);
  return PhaseModelFormSchema.parse(parsedJson);
}
