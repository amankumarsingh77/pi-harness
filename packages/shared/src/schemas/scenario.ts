import { z } from "zod";
import { BlastRadiusRefSchema, RequirementRefSchema } from "./blast-radius.js";

const SetupSchema = z.array(z.object({ bash: z.string() })).optional();
const ScenarioRefsSchema = {
  requirementRefs: z.array(RequirementRefSchema).optional(),
  blastRadiusRefs: z.array(BlastRadiusRefSchema).optional(),
};

const ApiScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.literal("api"),
  name: z.string().min(1),
  ...ScenarioRefsSchema,
  setup: SetupSchema,
  request: z.object({
    method: z.string(),
    url: z.string().url().or(z.string().startsWith("http")),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  }),
  expect: z.object({
    status: z.number().int().min(100).max(599),
    body_contains: z.array(z.string()).optional(),
  }),
});

const UiStepSchema = z.union([
  z.object({ navigate: z.string() }),
  z.object({ fill: z.object({ selector: z.string(), value: z.string() }) }),
  z.object({ click: z.string() }),
  z.object({ wait_for_url: z.string() }),
]);

const UiScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.literal("ui"),
  name: z.string().min(1),
  ...ScenarioRefsSchema,
  setup: SetupSchema,
  steps: z.array(UiStepSchema).min(1),
  expect: z.object({
    url_matches: z.string().optional(),
    screenshot: z.string().optional(),
  }),
});

const UiVisualScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.literal("ui-visual"),
  name: z.string().min(1),
  ...ScenarioRefsSchema,
  steps: z.array(UiStepSchema).min(1),
  capture: z.object({
    selector: z.string().optional(),
    full_page: z.boolean().optional(),
    filename: z.string().min(1),
  }),
});

export const ScenarioSchema = z.discriminatedUnion("type", [
  ApiScenarioSchema,
  UiScenarioSchema,
  UiVisualScenarioSchema,
]);

export const ScenarioFileSchema = z
  .object({ scenarios: z.array(ScenarioSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const s of file.scenarios) {
      if (seen.has(s.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate scenario id: ${s.id}`, path: ["scenarios"] });
      }
      seen.add(s.id);
    }
  });
