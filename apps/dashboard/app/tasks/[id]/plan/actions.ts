"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { orchestrator } from "@/lib/server/api";

// Plan-phase mutations. Server actions over client fetches per the project's
// Mutations rule: every action ends with revalidatePath / redirect cast as
// Route. Same posture as app/tasks/new/actions.ts.

export async function approvePlan(taskId: string): Promise<void> {
  await orchestrator.transitionTask(taskId, { type: "user_approve_plan" });
  revalidatePath(`/tasks/${taskId}/plan`);
  revalidatePath(`/tasks/${taskId}`);
  redirect(`/tasks/${taskId}` as Route);
}

export async function requestPlanChanges(taskId: string, comment: string): Promise<void> {
  if (comment.trim().length < 10) {
    throw new Error("comment must be at least 10 characters");
  }
  await orchestrator.transitionTask(taskId, {
    type: "user_request_plan_changes",
    comment,
  });
  revalidatePath(`/tasks/${taskId}/plan`);
}

export async function restartPlan(taskId: string, note?: string): Promise<void> {
  await orchestrator.restartPlan(taskId, note ? { note } : {});
  revalidatePath(`/tasks/${taskId}/plan`);
}

export async function editPlanArtifact(taskId: string, body: string): Promise<void> {
  await orchestrator.submitPlanArtifactEdit(taskId, { kind: "plan", body });
  revalidatePath(`/tasks/${taskId}/plan`);
}
