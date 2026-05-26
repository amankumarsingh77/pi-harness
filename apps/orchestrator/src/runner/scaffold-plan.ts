import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Artifact } from "@pi-harness/shared";
import { ArtifactsStore } from "../agents/artifacts-store.js";

export type ScaffoldPlanOpts = {
  cwd: string;          // worktree root
  taskId: string;       // e.g. "T-001"
  branch: string;       // e.g. "pi/T-001"
  store?: ArtifactsStore;
};

export type ScaffoldPlanResult = {
  created: boolean;
  planPath: string;
  scenariosPath: string;
  blastRadiusPath: string;
  executionDagPath: string;
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
  const store = opts.store ?? new ArtifactsStore();
  const planPath = store.artifactPath(opts.cwd, opts.taskId, "plan");
  const scenariosPath = store.artifactPath(opts.cwd, opts.taskId, "scenarios");
  const blastRadiusPath = store.artifactPath(opts.cwd, opts.taskId, "blast-radius");
  const executionDagPath = store.artifactPath(opts.cwd, opts.taskId, "execution-dag");
  const dir = store.artifactDir(opts.cwd, opts.taskId);
  const gitignorePath = join(dir, ".gitignore");

  const filesExist =
    existsSync(planPath) &&
    existsSync(scenariosPath) &&
    existsSync(blastRadiusPath) &&
    existsSync(executionDagPath);
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
    const executionDag: Artifact = {
      fm: {
        task: opts.taskId,
        kind: "execution-dag",
        parent: "plan.md",
        status: "draft",
        branch: opts.branch,
        last_updated: ts,
        last_updated_by: "orchestrator",
      },
      body: "version: 1\nnodes: []\n",
    };
    await store.writeArtifact(opts.cwd, opts.taskId, plan);
    await store.writeArtifact(opts.cwd, opts.taskId, scenarios);
    await store.writeArtifact(opts.cwd, opts.taskId, blastRadius);
    await store.writeArtifact(opts.cwd, opts.taskId, executionDag);
  }

  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, "research/\n");
  }

  return {
    created: !filesExist,
    planPath,
    scenariosPath,
    blastRadiusPath,
    executionDagPath,
  };
}
