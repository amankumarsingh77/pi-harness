import { z } from "zod";

export const RequirementRefSchema = z.string().regex(/^REQ-\d+$/);
export const BlastRadiusRefSchema = z.string().regex(/^BR-\d+$/);

export const BlastRadiusTouchpointSchema = z.object({
  path: z.string().min(1),
  role: z.enum(["change", "consumer", "dependency", "test", "config"]),
  note: z.string().min(1),
});

export const BlastRadiusItemSchema = z.object({
  id: BlastRadiusRefSchema,
  requirementRefs: z.array(RequirementRefSchema).min(1),
  surface: z.enum(["api", "ui", "db", "worker", "config", "test", "external"]),
  title: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  touchpoints: z.array(BlastRadiusTouchpointSchema).min(1),
  inbound: z.array(z.string()),
  outbound: z.array(z.string()),
  precedentRefs: z.array(z.string()),
  verificationRefs: z.array(z.string()),
});

export const BlastRadiusFileSchema = z
  .object({
    items: z.array(BlastRadiusItemSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const item of file.items) {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate blast radius id: ${item.id}`,
          path: ["items"],
        });
      }
      seen.add(item.id);
    }
  });
