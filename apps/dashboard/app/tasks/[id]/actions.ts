"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import type { Workflow } from "@pi-harness/shared";
import { orchestrator } from "@/lib/server/api";

type Action =
  | { type: "user_start_brainstorm"; workflow: Workflow }
  | { type: "user_approve_brainstorm" }
  | { type: "user_request_brainstorm_changes"; comment: string }
  | { type: "user_approve_plan" }
  | { type: "user_cancel" }
  | { type: "user_retry_failed" };

// Bound at the call site with .bind(null, taskId, action). The trailing
// FormData is unused — server-action forms always pass it.
export async function transitionTask(
  taskId: string,
  action: Action,
  _formData: FormData,
): Promise<void> {
  await orchestrator.transitionTask(taskId, action);
  revalidatePath("/");
  revalidatePath(`/tasks/${taskId}`);
}

// Brainstorm-specific actions used by chat-panel and approval-gate. These
// don't take FormData because they're called from React event handlers, not
// <form action={...}> bindings.

export async function submitBrainstormAnswerAction(
  taskId: string,
  payload: { questionId: string; optionId?: string; optionIds?: string[]; freeText?: string },
): Promise<void> {
  await orchestrator.submitBrainstormAnswer(taskId, payload);
  revalidatePath(`/tasks/${taskId}/brainstorm`);
}

export async function approveBrainstormAction(taskId: string): Promise<void> {
  await orchestrator.transitionTask(taskId, { type: "user_approve_brainstorm" });
  revalidatePath("/");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath(`/tasks/${taskId}/brainstorm`);
  // Brainstorm is approved; the task moved into `planning`. Send the user to
  // the plan page so they're not stranded on /brainstorm with a stale gate.
  // (redirect throws internally — keep it last so the prior revalidations run.)
  redirect(`/tasks/${taskId}/plan` as Route);
}

export async function requestBrainstormChangesAction(
  taskId: string,
  comment: string,
): Promise<void> {
  await orchestrator.transitionTask(taskId, {
    type: "user_request_brainstorm_changes",
    comment,
  });
  revalidatePath(`/tasks/${taskId}/brainstorm`);
}
