import { existsSync } from "node:fs";
import type { Artifact } from "@pi-harness/shared";
import { ArtifactsStore } from "../agents/artifacts-store.js";

export type ScaffoldOpts = {
  cwd: string;          // worktree root
  taskId: string;       // e.g. "T-001" — also the .harness/<taskId>/ directory name
  branch: string;       // e.g. "pi/T-001"
  store?: ArtifactsStore;
};

export type ScaffoldResult = {
  created: boolean;     // true when files were written; false on no-op (already scaffolded)
  designPath: string;
  specPath: string;
};

// Materialize empty design.md and spec.md inside the worktree at
// `<cwd>/.harness/<taskId>/` with `status: draft` frontmatter. Idempotent:
// if the artifacts already exist, returns immediately without re-writing.
//
// This is the brainstorm phase's entry hook — it runs *before* the subagent
// boots so the subagent always has writable, frontmatter-bearing files in the
// expected location. Goes through ArtifactsStore so the canonical
// `.harness/<taskId>/` path centralization and atomic-write semantics apply.
export async function scaffoldBrainstorm(opts: ScaffoldOpts): Promise<ScaffoldResult> {
  const store = opts.store ?? new ArtifactsStore();
  const designPath = store.artifactPath(opts.cwd, opts.taskId, "design");
  const specPath = store.artifactPath(opts.cwd, opts.taskId, "spec");

  const filesExist = existsSync(designPath) && existsSync(specPath);
  const ts = new Date().toISOString();

  if (!filesExist) {
    const design: Artifact = {
      fm: {
        task: opts.taskId,
        kind: "design",
        parent: null,
        status: "draft",
        branch: opts.branch,
        last_updated: ts,
        last_updated_by: "orchestrator",
      },
      body: "# Design\n\n_Draft — populated by the brainstorm subagent._\n",
    };
    const spec: Artifact = {
      fm: {
        task: opts.taskId,
        kind: "spec",
        parent: "design.md",
        status: "draft",
        branch: opts.branch,
        last_updated: ts,
        last_updated_by: "orchestrator",
      },
      body: "# Spec\n\n_Draft — populated by the brainstorm subagent._\n",
    };
    await store.writeArtifact(opts.cwd, opts.taskId, design);
    await store.writeArtifact(opts.cwd, opts.taskId, spec);
  }

  return { created: !filesExist, designPath, specPath };
}
