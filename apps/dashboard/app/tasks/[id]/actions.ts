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

// Submit every answer in a question batch atomically. The dashboard's
// QuestionBatch component disables Submit until each question has a
// selection, so partial submission can't happen — but the orchestrator
// would still accept any non-empty array, so the constraint is purely
// client-side UX.
export async function submitBrainstormAnswersAction(
  taskId: string,
  answers: {
    questionId: string;
    optionId?: string;
    optionIds?: string[];
    freeText?: string;
  }[],
): Promise<void> {
  await orchestrator.submitBrainstormAnswers(taskId, { answers });
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

// Inject a free-form nudge into the agent. The orchestrator appends a
// brainstorm_user_nudge to JSONL; the next agent tick folds it into the
// prompt.
export async function submitBrainstormNudgeAction(
  taskId: string,
  comment: string,
): Promise<void> {
  await orchestrator.submitBrainstormNudge(taskId, { comment });
  revalidatePath(`/tasks/${taskId}/brainstorm`);
}

// Replace an artifact's body with a user-authored version. The orchestrator
// commits the edit on the task branch and emits brainstorm_artifact_edited.
export async function submitArtifactEditAction(
  taskId: string,
  kind: "design" | "spec",
  body: string,
): Promise<void> {
  await orchestrator.submitArtifactEdit(taskId, { kind, body });
  revalidatePath(`/tasks/${taskId}/brainstorm`);
}

export async function submitBrainstormMockEditAction(
  taskId: string,
  mockId: string,
  comment: string,
): Promise<void> {
  const trimmed = comment.trim();
  if (trimmed.length === 0) return;
  await orchestrator.submitBrainstormMockEdit(taskId, mockId, { comment: trimmed });
  revalidatePath(`/tasks/${taskId}/brainstorm`);
  revalidatePath(`/tasks/${taskId}/brainstorm/mocks/${mockId}`);
}

export async function selectBrainstormMockAction(
  taskId: string,
  mockId: string,
): Promise<void> {
  await orchestrator.selectBrainstormMock(taskId, mockId);
  revalidatePath(`/tasks/${taskId}/brainstorm`);
  revalidatePath(`/tasks/${taskId}/brainstorm/mocks/${mockId}`);
}

// Discard the current brainstorm run and start fresh. Old artifacts archive
// under runs/<oldRunId>/ on the same task branch; an optional `note` is
// seeded as the first nudge in the new run.
export async function restartBrainstormAction(
  taskId: string,
  note: string | undefined,
): Promise<void> {
  const trimmed = note?.trim();
  await orchestrator.restartBrainstorm(taskId, {
    ...(trimmed && trimmed.length > 0 ? { note: trimmed } : {}),
  });
  revalidatePath("/");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath(`/tasks/${taskId}/brainstorm`);
}
