import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";
import { stringifyArtifact, type Artifact } from "@pi-harness/shared";

export type ScaffoldOpts = {
  cwd: string;          // worktree root
  taskId: string;       // e.g. "T-001" — also the .harness/<taskId>/ directory name
  branch: string;       // e.g. "pi/T-001"
};

export type ScaffoldResult = {
  created: boolean;     // true when files were written; false on no-op (already scaffolded)
  designPath: string;
  specPath: string;
};

// Materialize empty design.md and spec.md inside the worktree at
// `<cwd>/.harness/<taskId>/`, with `status: draft` frontmatter, then commit
// them on the worktree's branch. Idempotent: if the artifacts already exist,
// returns immediately without re-writing or re-committing.
//
// This is the brainstorm phase's entry hook — it runs *before* the subagent
// boots so the subagent always has writable, frontmatter-bearing files in the
// expected location.
export async function scaffoldBrainstorm(opts: ScaffoldOpts): Promise<ScaffoldResult> {
  const dir = join(opts.cwd, ".harness", opts.taskId);
  const designPath = join(dir, "design.md");
  const specPath = join(dir, "spec.md");

  const filesExist = existsSync(designPath) && existsSync(specPath);

  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString();

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
  if (!filesExist) await writeFile(designPath, stringifyArtifact(design));

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
  if (!filesExist) await writeFile(specPath, stringifyArtifact(spec));

  const git = simpleGit(opts.cwd);
  // Force-add: the harness repo's own .gitignore ignores `.harness/` so a
  // plain `git add` fails. The artifacts live inside the worktree's
  // `.harness/<taskId>/` directory regardless — they're branch-scoped, not
  // ignored output.
  await git.raw(["add", "-f", ".harness"]);
  // Only commit when there's something staged. Idempotency: a second call
  // after a successful first call has nothing to commit and would otherwise
  // throw.
  const status = await git.status();
  if (status.staged.length > 0) {
    await git.commit(`chore(${opts.taskId}): brainstorm scaffolding`);
    return { created: true, designPath, specPath };
  }

  return { created: false, designPath, specPath };
}
