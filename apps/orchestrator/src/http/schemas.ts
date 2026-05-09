import { z } from "zod";
import { WORKFLOWS } from "@pi-harness/shared";

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
});

export const TransitionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_start_brainstorm"),
    workflow: z.enum(WORKFLOWS),
  }),
  z.object({ type: z.literal("user_approve_brainstorm") }),
  z.object({
    type: z.literal("user_request_brainstorm_changes"),
    comment: z.string().min(10).max(2000),
  }),
  z.object({ type: z.literal("user_approve_plan") }),
  z.object({ type: z.literal("user_approve_scenarios") }),
  z.object({ type: z.literal("user_cancel") }),
  z.object({ type: z.literal("user_retry_failed") }),
]);
