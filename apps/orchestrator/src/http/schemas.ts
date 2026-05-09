import { z } from "zod";
import { WORKFLOWS, PHASES, THINKING_LEVELS } from "@pi-harness/shared";

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
});

// Partial<PhaseModelConfig>: every field optional so a patch can flip a single
// knob (e.g. just thinkingLevel) without restating provider/model/maxTurns.
const PhaseModelOverrideSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    thinkingLevel: z.enum(THINKING_LEVELS),
    maxTurns: z.number().int().positive(),
  })
  .partial()
  .strict();

// Keys constrained to the phase enum so unknown keys (e.g. "deploy") fail
// validation before the freeze gate runs.
export const PhaseModelsPatchSchema = z
  .record(z.enum(PHASES), PhaseModelOverrideSchema)
  .refine((v) => v !== null && typeof v === "object" && !Array.isArray(v));

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).optional(),
    phaseModels: PhaseModelsPatchSchema.optional(),
  })
  .strict();

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
