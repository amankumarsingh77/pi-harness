import { z } from "zod";
import { ScenarioFileSchema } from "./scenario.js";
import { WORKFLOWS } from "../types/task.js";

export const BrainstormArtifactSchema = z.object({
  // Empty string is allowed: an in-flight brainstorm has no goal yet, and the
  // dashboard renders the task title as a fallback.
  goal: z.string(),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  suggestedWorkflow: z.enum(WORKFLOWS),
  transcript: z.array(
    z.object({ role: z.enum(["agent", "user"]), text: z.string(), ts: z.string() }),
  ),
});

export const PlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  files: z.array(
    z.object({ path: z.string().min(1), action: z.enum(["create", "modify"]) }),
  ),
  patternRef: z.string().optional(),
  assertion: z.string().min(1),
});

export const PlanArtifactSchema = z.object({
  goal: z.string().min(1),
  patternsToFollow: z.array(z.object({ ref: z.string(), note: z.string() })),
  touchpoints: z.array(
    z.object({ layer: z.string(), files: z.array(z.string()), finding: z.string() }),
  ),
  blastRadius: z.array(z.string()),
  precedentWarnings: z.array(z.object({ ref: z.string(), lesson: z.string() })),
  steps: z.array(PlanStepSchema),
  verificationScenarios: ScenarioFileSchema,
  outOfScope: z.array(z.string()),
  suggestedWorkflow: z.enum(WORKFLOWS),
});

export const ScenarioResultSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["api", "ui", "ui-visual"]),
  ok: z.boolean(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  evidence: z.object({
    responseFile: z.string().optional(),
    screenshotFile: z.string().optional(),
    status: z.number().optional(),
  }),
});

export const ProofReportSchema = z.object({
  runId: z.string().min(1),
  ok: z.boolean(),
  scenarios: z.array(ScenarioResultSchema),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});
