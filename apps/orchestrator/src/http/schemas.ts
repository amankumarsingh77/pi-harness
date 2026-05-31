import { z } from "zod";
import { WORKFLOWS, PHASES, THINKING_LEVELS, TASK_PRIORITIES } from "@pi-harness/shared";

const MAX_TAGS = 8;

function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

function normalizeTags(rawTags: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of rawTags) {
    const tag = normalizeTag(raw);
    if (tag.length > 0) unique.add(tag);
    if (unique.size >= MAX_TAGS) break;
  }
  return [...unique];
}

// Partial<PhaseModelConfig>: every field optional so a patch can flip a single
// knob (e.g. just thinkingLevel) without restating provider/model.
const PhaseModelOverrideSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    thinkingLevel: z.enum(THINKING_LEVELS),
  })
  .partial()
  .strict();

// Keys constrained to the phase enum so unknown keys (e.g. "deploy") fail
// validation before the freeze gate runs.
export const PhaseModelsPatchSchema = z
  .record(z.enum(PHASES), PhaseModelOverrideSchema)
  .refine((v) => v !== null && typeof v === "object" && !Array.isArray(v));

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  priority: z.enum(TASK_PRIORITIES).default("none"),
  tags: z.array(z.string().max(40)).max(16).optional().transform((tags) => normalizeTags(tags ?? [])),
  phaseModels: PhaseModelsPatchSchema.optional(),
});

export const UpdateTaskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tags: z.array(z.string().max(40)).max(16).optional().transform((tags) => tags === undefined ? undefined : normalizeTags(tags)),
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
  z.object({
    type: z.literal("user_request_plan_changes"),
    comment: z.string().min(10).max(2000),
  }),
  z.object({ type: z.literal("user_cancel_current_phase") }),
  z.object({ type: z.literal("user_cancel") }),
  z.object({ type: z.literal("user_retry_failed") }),
]);
