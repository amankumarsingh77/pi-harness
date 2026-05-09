import { z } from "zod";

// Branch-scoped artifact model. Used by the brainstorm phase (design.md +
// spec.md) and any future phase that needs to commit per-task artifacts to
// the worktree's branch. See:
// docs/superpowers/specs/2026-05-09-brainstorm-phase-design.md (Decisions §1, §6, §9).
export const ArtifactKindSchema = z.enum(["design", "spec"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactStatusSchema = z.enum(["draft", "ready", "approved"]);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export const FrontmatterSchema = z.object({
  task: z.string(),                          // "T-NNN"
  kind: ArtifactKindSchema,
  parent: z.string().nullable(),             // path to parent artifact, or null
  status: ArtifactStatusSchema,
  commit: z.string().optional(),             // sha at write time, optional
  branch: z.string(),                        // "pi/T-NNN"
  last_updated: z.string(),                  // ISO 8601
  last_updated_by: z.string(),               // "orchestrator" | "brainstorm-agent" | "user"
});
export type Frontmatter = z.infer<typeof FrontmatterSchema>;

export type Artifact = {
  fm: Frontmatter;
  body: string;
};
