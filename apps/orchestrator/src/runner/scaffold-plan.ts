import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { Artifact } from "@pi-harness/shared";
import { ArtifactsStore } from "../agents/artifacts-store.js";
import { withGitLockDiagnostic } from "./git-diagnostics.js";

export type ScaffoldPlanOpts = {
  cwd: string;          // worktree root
  taskId: string;       // e.g. "T-001"
  branch: string;       // e.g. "pi/T-001"
};

export type ScaffoldPlanResult = {
  created: boolean;
  planPath: string;
  scenariosPath: string;
  blastRadiusPath: string;
};

// Materialize plan.md + scenarios.yaml inside the worktree at
// `<cwd>/.harness/<taskId>/`, plus a per-task `.gitignore` excluding
// `research/` so the preflight subagents' findings stay uncommitted.
// Then commit on the worktree's branch. Idempotent.
//
// Mirrors scaffold-brainstorm.ts but writes plan-phase artifacts. The per-task
// .gitignore is the key new piece: the root .gitignore excludes `.harness/`
// but we force-add `.harness/<taskId>/`, which would otherwise sweep
// `research/<name>.md` files into the planner's commits.
export async function scaffoldPlan(opts: ScaffoldPlanOpts): Promise<ScaffoldPlanResult> {
  const store = new ArtifactsStore();
  const planPath = store.artifactPath(opts.cwd, opts.taskId, "plan");
  const scenariosPath = store.artifactPath(opts.cwd, opts.taskId, "scenarios");
  const blastRadiusPath = store.artifactPath(opts.cwd, opts.taskId, "blast-radius");
  const dir = store.artifactDir(opts.cwd, opts.taskId);
  const gitignorePath = join(dir, ".gitignore");

  const filesExist =
    existsSync(planPath) && existsSync(scenariosPath) && existsSync(blastRadiusPath);
  const ts = new Date().toISOString();

  if (!filesExist) {
    const plan: Artifact = {
      fm: {
        task: opts.taskId,
        kind: "plan",
        parent: "design.md",
        status: "draft",
        branch: opts.branch,
        last_updated: ts,
        last_updated_by: "orchestrator",
      },
      body: "# Plan\n\n_Draft — populated by the plan agent._\n",
    };
    const scenarios: Artifact = {
      fm: {
        task: opts.taskId,
        kind: "scenarios",
        parent: "plan.md",
        status: "draft",
        branch: opts.branch,
        last_updated: ts,
        last_updated_by: "orchestrator",
      },
      // Empty scenarios document. The planner re-writes this with concrete
      // scenarios conforming to ScenarioFileSchema before mark_ready.
      body: "scenarios: []\n",
    };
    const blastRadius: Artifact = {
      fm: {
        task: opts.taskId,
        kind: "blast-radius",
        parent: "spec.md",
        status: "draft",
        branch: opts.branch,
        last_updated: ts,
        last_updated_by: "orchestrator",
      },
      body: "items: []\n",
    };
    await store.writeArtifact(opts.cwd, opts.taskId, plan);
    await store.writeArtifact(opts.cwd, opts.taskId, scenarios);
    await store.writeArtifact(opts.cwd, opts.taskId, blastRadius);
  }

  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, "research/\n");
  }

  const git = simpleGit(opts.cwd);
  const created = await withGitLockDiagnostic(
    { taskId: opts.taskId, operation: "plan scaffolding" },
    async () => {
      await git.raw(["add", "-f", ".harness"]);
      const status = await git.status();
      if (status.staged.length === 0) return false;
      await git.commit(`chore(${opts.taskId}): plan scaffolding`);
      return true;
    },
  );

  return { created, planPath, scenariosPath, blastRadiusPath };
}
