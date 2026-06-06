import { z } from "zod";

export const TokenChangeSchema = z.object({
  name: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type TokenChange = z.infer<typeof TokenChangeSchema>;

export const TokenDiffSchema = z.object({
  fromVersion: z.number().int().min(0),
  toVersion: z.number().int().min(1),
  summary: z.string().min(1),
  changes: z.array(TokenChangeSchema),
  designMdDelta: z.string(),
});
export type TokenDiff = z.infer<typeof TokenDiffSchema>;

export const DesignExemplarSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  png: z.string().min(1),
  promotedFromTask: z.string().min(1),
  promotedMockId: z.string().min(1),
  tokenVersion: z.number().int().min(1),
});

export const DesignHistoryEntrySchema = z.object({
  tokenVersion: z.number().int().min(1),
  task: z.string().min(1),
  summary: z.string().min(1),
});

export const DesignSystemManifestSchema = z.object({
  tokenVersion: z.number().int().min(0),
  updatedAt: z.string().min(1),
  exemplars: z.array(DesignExemplarSchema),
  history: z.array(DesignHistoryEntrySchema),
});
export type DesignSystemManifest = z.infer<typeof DesignSystemManifestSchema>;

export function emptyManifest(): DesignSystemManifest {
  return { tokenVersion: 0, updatedAt: "1970-01-01T00:00:00.000Z", exemplars: [], history: [] };
}
