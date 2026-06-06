import matter from "gray-matter";
import {
  type Artifact,
  type Frontmatter,
  FrontmatterSchema,
} from "./types/artifact.js";

// Parse a markdown file with YAML frontmatter into a strict Artifact.
// Throws (via Zod) if the frontmatter doesn't match the schema — we never
// want to silently accept a malformed artifact and propagate it through the
// pipeline.
export function parseArtifact(raw: string): Artifact {
  const { data, content } = matter(raw);
  const fm = FrontmatterSchema.parse(data);
  return { fm, body: content };
}

// Inverse of parseArtifact. Produces a stable, deterministic markdown string
// (frontmatter keys in declaration order) suitable for git commits.
export function stringifyArtifact(art: Artifact): string {
  // gray-matter's stringify uses js-yaml under the hood; we order keys
  // explicitly to keep diffs predictable across writes.
  const ordered: Frontmatter = {
    task: art.fm.task,
    kind: art.fm.kind,
    parent: art.fm.parent,
    ...(art.fm.phase !== undefined ? { phase: art.fm.phase } : {}),
    status: art.fm.status,
    ...(art.fm.commit !== undefined ? { commit: art.fm.commit } : {}),
    branch: art.fm.branch,
    last_updated: art.fm.last_updated,
    last_updated_by: art.fm.last_updated_by,
  };
  // matter.stringify accepts (content, data) and a YAML language option; the
  // sortKeys option would re-sort, defeating our explicit order.
  const out = matter.stringify(art.body, ordered);
  // gray-matter trims trailing newline inconsistently; normalize.
  return out.endsWith("\n") ? out : `${out}\n`;
}
