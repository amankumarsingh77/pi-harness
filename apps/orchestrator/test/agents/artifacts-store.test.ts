import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { Artifact } from "@pi-harness/shared";
import {
  ArtifactsStore,
  LegacyRunArtifactsStore,
} from "../../src/agents/artifacts-store.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "art-"));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("LegacyRunArtifactsStore", () => {
  it("writes and reads brainstorm artifact", async () => {
    const store = new LegacyRunArtifactsStore({ runsDir: scratch });
    const art = {
      goal: "x",
      decisions: [],
      openQuestions: [],
      suggestedWorkflow: "backend-feature" as const,
      transcript: [],
    };
    await store.writeBrainstorm("task-1", art);
    const back = await store.readBrainstorm("task-1");
    expect(back.goal).toBe("x");

    // also writes a markdown sibling for the dashboard
    const md = await readFile(join(scratch, "task-1", "brainstorm.md"), "utf8");
    expect(md).toContain("Goal");
  });

  it("paths are scoped under task-id dir", async () => {
    const store = new LegacyRunArtifactsStore({ runsDir: scratch });
    expect(store.runDir("task-2")).toBe(join(scratch, "task-2"));
    expect(store.proofDir("task-2")).toBe(join(scratch, "task-2", "proof"));
  });
});

describe("ArtifactsStore", () => {
  let cwd: string;
  let stateDir: string;
  let git: ReturnType<typeof simpleGit>;

  beforeEach(async () => {
    cwd = join(scratch, "wt");
    stateDir = join(scratch, "state");
    await mkdir(cwd, { recursive: true });
    git = simpleGit(cwd);
    await git.init();
    await git.addConfig("user.email", "test@example.com", false, "local");
    await git.addConfig("user.name", "Test", false, "local");
    await writeFile(join(cwd, "README.md"), "init\n");
    await git.add("README.md");
    await git.commit("init");
    await git.checkoutLocalBranch("pi/T-1");
  });

  const sample: Artifact = {
    fm: {
      task: "T-1",
      kind: "design",
      parent: null,
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-09T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body: "# Design\n\nbody\n",
  };

  it("readArtifact returns null when missing", async () => {
    const store = new ArtifactsStore({ stateDir });
    const got = await store.readArtifact(cwd, "T-1", "design");
    expect(got).toBeNull();
  });

  it("write + read round-trips an artifact through central state and worktree mirror", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    const got = await store.readArtifact(cwd, "T-1", "design");
    expect(got?.fm).toEqual(sample.fm);
    expect(got?.body.trim()).toBe(sample.body.trim());
    expect(await readFile(store.currentArtifactPath(cwd, "T-1", "design"), "utf8")).toContain("# Design");
    expect(await readFile(store.artifactPath(cwd, "T-1", "design"), "utf8")).toContain("# Design");
  });

  it("round-trips numbered phase plan artifacts", async () => {
    const store = new ArtifactsStore({ stateDir });
    const phasePlan: Artifact = {
      fm: {
        task: "T-1",
        kind: "phase-plan",
        parent: "plan.md",
        phase: 1,
        status: "draft",
        branch: "pi/T-1",
        last_updated: "2026-05-09T00:00:00.000Z",
        last_updated_by: "plan-agent",
      },
      body: "# Phase 1\n\n## Objective\nShip contracts.\n",
    };

    await store.writeArtifact(cwd, "T-1", phasePlan);

    const got = await store.readPhasePlanArtifact(cwd, "T-1", 1);
    expect(got?.body).toContain("Ship contracts");
    expect(await readFile(store.phasePlanArtifactPath(cwd, "T-1", 1), "utf8")).toContain("kind: phase-plan");
    expect(await readFile(store.currentPhasePlanArtifactPath(cwd, "T-1", 1), "utf8")).toContain("# Phase 1");
    expect((await store.listPhasePlanArtifacts(cwd, "T-1")).map((art) => art.fm.phase)).toEqual([1]);
  });

  it("writeArtifact is atomic (no .tmp file remains on success)", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    const dir = store.currentArtifactDir(cwd, "T-1");
    const files = await readFile(join(dir, "design.md"), "utf8");
    expect(files).toContain("status: draft");
    const fs = await import("node:fs");
    const remaining = fs.readdirSync(dir).filter((f) => f.startsWith("design.md.tmp-"));
    expect(remaining).toHaveLength(0);
  });

  it("imports a newer worktree mirror into central state on read", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(
      store.artifactPath(cwd, "T-1", "design"),
      [
        "---",
        "task: T-1",
        "kind: design",
        "parent: null",
        "status: draft",
        "branch: pi/T-1",
        "last_updated: '2026-05-09T00:00:01.000Z'",
        "last_updated_by: brainstorm-agent",
        "---",
        "# Design",
        "",
        "mirror-authored body",
        "",
      ].join("\n"),
    );

    const got = await store.readArtifact(cwd, "T-1", "design");

    expect(got?.body).toContain("mirror-authored body");
    expect(await readFile(store.currentArtifactPath(cwd, "T-1", "design"), "utf8")).toContain(
      "mirror-authored body",
    );
  });

  it("setArtifactStatus mutates frontmatter and records a revision without committing", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    const updated = await store.setArtifactStatus(cwd, "T-1", "design", "approved", "user");
    expect(updated.fm.status).toBe("approved");
    expect(updated.fm.last_updated_by).toBe("user");
    const baseline = await store.findDiffBaseline(cwd, "T-1", "design", null);
    expect(baseline).not.toBeNull();
    const log = await git.log();
    expect(log.latest?.message).toBe("init");
  });

  it("archiveCurrentRun moves brainstorm-owned files into central runs/<runId>", async () => {
    const store = new ArtifactsStore({ stateDir });
    // Lay down the four files the archive helper relocates.
    await store.writeArtifact(cwd, "T-1", sample);
    const spec: Artifact = {
      fm: { ...sample.fm, kind: "spec", parent: "design.md" },
      body: "# Spec\n\nstuff\n",
    };
    await store.writeArtifact(cwd, "T-1", spec);
    const dir = store.artifactDir(cwd, "T-1");
    await writeFile(join(dir, "brainstorm.jsonl"), "{\"kind\":\"x\"}\n");
    await writeFile(join(dir, "pi-session.jsonl"), "session-data\n");

    await store.archiveCurrentRun(cwd, "T-1", "r_old", "brainstorm");

    const { existsSync } = await import("node:fs");
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "design"))).toBe(false);
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "spec"))).toBe(false);
    const archive = join(store.taskRunDir(cwd, "T-1", "r_old"));
    expect(existsSync(join(archive, "design.md"))).toBe(true);
    expect(existsSync(join(archive, "spec.md"))).toBe(true);
    expect(existsSync(join(archive, "brainstorm.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "pi-session.jsonl"))).toBe(true);
  });

  it("archiveCurrentRun is idempotent on missing files (only what exists is moved)", async () => {
    const store = new ArtifactsStore({ stateDir });
    // Only design.md exists; spec.md, jsonl files missing.
    await store.writeArtifact(cwd, "T-1", sample);
    await store.archiveCurrentRun(cwd, "T-1", "r_partial", "brainstorm");

    const { existsSync } = await import("node:fs");
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "design"))).toBe(false);
    expect(existsSync(join(store.taskRunDir(cwd, "T-1", "r_partial"), "design.md"))).toBe(true);
    expect(existsSync(join(store.taskRunDir(cwd, "T-1", "r_partial"), "spec.md"))).toBe(false);
  });

  it("getArtifactAt returns the artifact body at a specific revision", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    const revision = await store.findDiffBaseline(cwd, "T-1", "design", null);
    if (!revision) throw new Error("missing revision");

    await store.writeArtifact(cwd, "T-1", { fm: sample.fm, body: "v2 body\n" });

    const v1 = await store.getArtifactAt(cwd, "T-1", "design", revision);
    expect(v1?.body).toBe("# Design\n\nbody\n");
  });

  it("getArtifactAt returns null when the ref is unknown or file missing at ref", async () => {
    const store = new ArtifactsStore({ stateDir });
    expect(
      await store.getArtifactAt(cwd, "T-1", "design", "nonexistent-ref"),
    ).toBeNull();
  });

  it("findDiffBaseline anchors to the first recorded revision when no revisions were requested", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    await store.writeArtifact(cwd, "T-1", { fm: sample.fm, body: "filled\n" });
    await store.setArtifactStatus(cwd, "T-1", "design", "ready", "agent");

    const baseline = await store.findDiffBaseline(cwd, "T-1", "design", null);
    if (!baseline) throw new Error("missing baseline");
    const art = await store.getArtifactAt(cwd, "T-1", "design", baseline);
    expect(art?.body).toBe("# Design\n\nbody\n");
  });

  it("findDiffBaseline anchors to the artifact revision at-or-before the revision ts", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    // Wait one ms so timestamps don't collide on coarse clocks.
    await new Promise((r) => setTimeout(r, 1100));
    const revisionTs = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 1100));
    await store.writeArtifact(cwd, "T-1", { fm: sample.fm, body: "v2\n" });

    const baseline = await store.findDiffBaseline(cwd, "T-1", "design", revisionTs);
    if (!baseline) throw new Error("missing baseline");
    const art = await store.getArtifactAt(cwd, "T-1", "design", baseline);
    expect(art?.body).toBe("# Design\n\nbody\n");
  });

  it("findDiffBaseline returns null when no commits touch the artifact", async () => {
    const store = new ArtifactsStore({ stateDir });
    expect(await store.findDiffBaseline(cwd, "T-1", "design", null)).toBeNull();
  });

  it("applyHumanEdit replaces body, sets status to human_edited, and returns a revision id", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);

    const { artifact, artifactRevisionId, commitSha } = await store.applyHumanEdit(
      cwd,
      "T-1",
      "design",
      "# Design\n\nuser-authored body\n",
    );
    expect(artifact.fm.status).toBe("human_edited");
    expect(artifact.fm.last_updated_by).toBe("human");
    expect(artifact.body).toBe("# Design\n\nuser-authored body\n");
    expect(artifactRevisionId.length).toBeGreaterThan(0);
    expect(commitSha).toBe(artifactRevisionId);

    // Re-read confirms the disk contents match what was returned.
    const reread = await store.readArtifact(cwd, "T-1", "design");
    expect(reread?.fm.status).toBe("human_edited");
    expect(reread?.body).toBe("# Design\n\nuser-authored body\n");

    const log = await git.log();
    expect(log.latest?.message).toBe("init");
  });

  it("applyHumanEdit throws when the artifact doesn't exist yet", async () => {
    const store = new ArtifactsStore({ stateDir });
    await expect(
      store.applyHumanEdit(cwd, "T-1", "design", "anything"),
    ).rejects.toThrow(/not found/);
  });

  it("listArtifacts returns design then spec when both present", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    const spec: Artifact = {
      fm: { ...sample.fm, kind: "spec", parent: "design.md" },
      body: "# Spec\n",
    };
    await store.writeArtifact(cwd, "T-1", spec);
    const list = await store.listArtifacts(cwd, "T-1");
    expect(list.map((a) => a.fm.kind)).toEqual(["design", "spec"]);
  });

  // Plan-phase additions (kind extension to design/spec/plan/scenarios).

  const planSample: Artifact = {
    fm: {
      task: "T-1",
      kind: "plan",
      parent: "design.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-10T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body: "# Plan\n\nbody\n",
  };

  const scenariosSample: Artifact = {
    fm: {
      task: "T-1",
      kind: "scenarios",
      parent: "plan.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-10T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body: "scenarios: []\n",
  };

  const blastRadiusSample: Artifact = {
    fm: {
      task: "T-1",
      kind: "blast-radius",
      parent: "spec.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-10T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body: "items: []\n",
  };

  const executionDagSample: Artifact = {
    fm: {
      task: "T-1",
      kind: "execution-dag",
      parent: "plan.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-10T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body: "version: 1\nnodes: []\n",
  };

  it("plan + YAML plan artifacts round-trip with correct file extensions", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", planSample);
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    await store.writeArtifact(cwd, "T-1", blastRadiusSample);
    await store.writeArtifact(cwd, "T-1", executionDagSample);

    const planPath = store.artifactPath(cwd, "T-1", "plan");
    const scenariosPath = store.artifactPath(cwd, "T-1", "scenarios");
    const blastRadiusPath = store.artifactPath(cwd, "T-1", "blast-radius");
    const executionDagPath = store.artifactPath(cwd, "T-1", "execution-dag");
    expect(planPath.endsWith("plan.md")).toBe(true);
    expect(scenariosPath.endsWith("scenarios.yaml")).toBe(true);
    expect(blastRadiusPath.endsWith("blast-radius.yaml")).toBe(true);
    expect(executionDagPath.endsWith("execution-dag.yaml")).toBe(true);

    const plan = await store.readArtifact(cwd, "T-1", "plan");
    const scenarios = await store.readArtifact(cwd, "T-1", "scenarios");
    const blastRadius = await store.readArtifact(cwd, "T-1", "blast-radius");
    const executionDag = await store.readArtifact(cwd, "T-1", "execution-dag");
    expect(plan?.fm.kind).toBe("plan");
    expect(scenarios?.fm.kind).toBe("scenarios");
    expect(blastRadius?.fm.kind).toBe("blast-radius");
    expect(executionDag?.fm.kind).toBe("execution-dag");
    expect(scenarios?.body).toContain("scenarios:");
    expect(blastRadius?.body).toContain("items:");
    expect(executionDag?.body).toContain("version: 1");
  });

  it("setArtifactStatus on scenarios records a .yaml revision without committing", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    const updated = await store.setArtifactStatus(cwd, "T-1", "scenarios", "ready", "plan-agent");
    expect(updated.fm.status).toBe("ready");
    const baseline = await store.findDiffBaseline(cwd, "T-1", "scenarios", null);
    expect(baseline).not.toBeNull();
    const log = await git.log();
    expect(log.latest?.message).toBe("init");
  });

  it("listArtifacts returns all plan kinds when present", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    await store.writeArtifact(cwd, "T-1", { fm: { ...sample.fm, kind: "spec", parent: "design.md" }, body: "# Spec\n" });
    await store.writeArtifact(cwd, "T-1", planSample);
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    await store.writeArtifact(cwd, "T-1", blastRadiusSample);
    await store.writeArtifact(cwd, "T-1", executionDagSample);
    const list = await store.listArtifacts(cwd, "T-1");
    expect(list.map((a) => a.fm.kind)).toEqual([
      "design",
      "spec",
      "plan",
      "scenarios",
      "blast-radius",
      "execution-dag",
    ]);
  });

  it("listArtifacts honors a kinds filter", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    await store.writeArtifact(cwd, "T-1", planSample);
    const list = await store.listArtifacts(cwd, "T-1", ["plan"]);
    expect(list.map((a) => a.fm.kind)).toEqual(["plan"]);
  });

  it("archiveCurrentRun moves plan artifacts + research/ directory but preserves design and spec", async () => {
    const store = new ArtifactsStore({ stateDir });
    await store.writeArtifact(cwd, "T-1", sample);
    await store.writeArtifact(cwd, "T-1", {
      fm: { ...sample.fm, kind: "spec", parent: "design.md" },
      body: "# Spec\n",
    });
    await store.writeArtifact(cwd, "T-1", planSample);
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    await store.writeArtifact(cwd, "T-1", blastRadiusSample);
    await store.writeArtifact(cwd, "T-1", executionDagSample);
    const dir = store.artifactDir(cwd, "T-1");
    await writeFile(join(dir, "plan.jsonl"), "{\"kind\":\"x\"}\n");
    await writeFile(join(dir, "pi-session-plan.jsonl"), "session\n");
    await mkdir(join(dir, "research"), { recursive: true });
    await writeFile(join(dir, "research", "codebase-locator.md"), "# findings\n");

    await store.archiveCurrentRun(cwd, "T-1", "r_old", "plan");

    const { existsSync } = await import("node:fs");
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "design"))).toBe(true);
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "spec"))).toBe(true);
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "plan"))).toBe(false);
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "scenarios"))).toBe(false);
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "blast-radius"))).toBe(false);
    expect(existsSync(store.currentArtifactPath(cwd, "T-1", "execution-dag"))).toBe(false);
    expect(existsSync(join(dir, "plan.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "pi-session-plan.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "research"))).toBe(false);

    const archive = store.taskRunDir(cwd, "T-1", "r_old");
    expect(existsSync(join(archive, "design.md"))).toBe(false);
    expect(existsSync(join(archive, "spec.md"))).toBe(false);
    expect(existsSync(join(archive, "plan.md"))).toBe(true);
    expect(existsSync(join(archive, "scenarios.yaml"))).toBe(true);
    expect(existsSync(join(archive, "blast-radius.yaml"))).toBe(true);
    expect(existsSync(join(archive, "execution-dag.yaml"))).toBe(true);
    expect(existsSync(join(archive, "plan.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "pi-session-plan.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "research", "codebase-locator.md"))).toBe(true);
  });
});
