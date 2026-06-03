import { z } from "zod";
import { BlastRadiusRefSchema, RequirementRefSchema } from "./blast-radius.js";

// A scenario is a textual *brief*, not a script. The verifier agent reads
// `name` + `description` to decide how to set up the environment, which tools
// it needs (Playwright, a DB client, a CLI), how to exercise the behavior, and
// what proves it passed. `type` is a free-string arena hint (ui | api | db |
// cli | ...), not a closed set — adding a class needs no schema change.
export const ScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(20),
  requirementRefs: z.array(RequirementRefSchema).optional(),
  blastRadiusRefs: z.array(BlastRadiusRefSchema).optional(),
});

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
