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

  beforeEach(async () => {
    cwd = join(scratch, "wt");
    await mkdir(cwd, { recursive: true });
    const git = simpleGit(cwd);
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
    const store = new ArtifactsStore();
    const got = await store.readArtifact(cwd, "T-1", "design");
    expect(got).toBeNull();
  });

  it("write + read round-trips an artifact", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const got = await store.readArtifact(cwd, "T-1", "design");
    expect(got?.fm).toEqual(sample.fm);
    expect(got?.body.trim()).toBe(sample.body.trim());
  });

  it("writeArtifact is atomic (no .tmp file remains on success)", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const dir = store.artifactDir(cwd, "T-1");
    const files = await readFile(join(dir, "design.md"), "utf8");
    expect(files).toContain("status: draft");
    const fs = await import("node:fs");
    const remaining = fs.readdirSync(dir).filter((f) => f.startsWith("design.md.tmp-"));
    expect(remaining).toHaveLength(0);
  });

  it("setArtifactStatus mutates frontmatter and commits", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const git = simpleGit(cwd);
    await git.add([join(".harness", "T-1", "design.md")]);
    await git.commit("seed");
    const updated = await store.setArtifactStatus(cwd, "T-1", "design", "approved", "user");
    expect(updated.fm.status).toBe("approved");
    expect(updated.fm.last_updated_by).toBe("user");
    const log = await git.log();
    expect(log.latest?.message).toContain("mark design as approved");
  });

  it("archiveCurrentRun moves design.md, spec.md, jsonl files into runs/<runId>/ and commits", async () => {
    const store = new ArtifactsStore();
    // Lay down the four files the archive helper relocates.
    await store.writeArtifact(cwd, "T-1", sample);
    const spec: Artifact = {
      fm: { ...sample.fm, kind: "spec", parent: "design.md" },
      body: "# Spec\n\nstuff\n",
    };
    await store.writeArtifact(cwd, "T-1", spec);
    const dir = join(cwd, ".harness", "T-1");
    await writeFile(join(dir, "brainstorm.jsonl"), "{\"kind\":\"x\"}\n");
    await writeFile(join(dir, "pi-session.jsonl"), "session-data\n");

    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1")]);
    await git.commit("seed");

    await store.archiveCurrentRun(cwd, "T-1", "r_old");

    // Originals gone, archive populated.
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, "design.md"))).toBe(false);
    expect(existsSync(join(dir, "spec.md"))).toBe(false);
    expect(existsSync(join(dir, "brainstorm.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "pi-session.jsonl"))).toBe(false);
    const archive = join(dir, "runs", "r_old");
    expect(existsSync(join(archive, "design.md"))).toBe(true);
    expect(existsSync(join(archive, "spec.md"))).toBe(true);
    expect(existsSync(join(archive, "brainstorm.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "pi-session.jsonl"))).toBe(true);

    const log = await git.log();
    expect(log.latest?.message).toContain("archive run r_old");
  });

  it("archiveCurrentRun is idempotent on missing files (only what exists is moved)", async () => {
    const store = new ArtifactsStore();
    // Only design.md exists; spec.md, jsonl files missing.
    await store.writeArtifact(cwd, "T-1", sample);
    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    await git.commit("seed");

    await store.archiveCurrentRun(cwd, "T-1", "r_partial");

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(cwd, ".harness", "T-1", "design.md"))).toBe(false);
    expect(existsSync(join(cwd, ".harness", "T-1", "runs", "r_partial", "design.md"))).toBe(true);
    // The non-existent files don't crash and don't appear in archive.
    expect(existsSync(join(cwd, ".harness", "T-1", "runs", "r_partial", "spec.md"))).toBe(false);
  });

  it("getArtifactAt returns the artifact body at a specific commit", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    const commit = await git.commit("v1");

    // Update + commit a second version.
    await store.writeArtifact(cwd, "T-1", { fm: sample.fm, body: "v2 body\n" });
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    await git.commit("v2");

    const v1 = await store.getArtifactAt(cwd, "T-1", "design", commit.commit);
    expect(v1?.body).toBe("# Design\n\nbody\n");
    const v2 = await store.getArtifactAt(cwd, "T-1", "design", "HEAD");
    expect(v2?.body).toBe("v2 body\n");
  });

  it("getArtifactAt returns null when the ref is unknown or file missing at ref", async () => {
    const store = new ArtifactsStore();
    expect(
      await store.getArtifactAt(cwd, "T-1", "design", "nonexistent-ref"),
    ).toBeNull();
    // Ref exists (HEAD) but the file doesn't.
    expect(await store.getArtifactAt(cwd, "T-1", "design", "HEAD")).toBeNull();
  });

  it("findDiffBaseline anchors to the parent of the first 'mark ready' commit when no revisions", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    const initial = await git.commit("scaffold");
    // Update body, then mark ready.
    await store.writeArtifact(cwd, "T-1", { fm: sample.fm, body: "filled\n" });
    await store.setArtifactStatus(cwd, "T-1", "design", "ready", "agent");

    const baseline = await store.findDiffBaseline(cwd, "T-1", "design", null);
    expect(baseline).toBe(initial.commit);
  });

  it("findDiffBaseline anchors to the artifact commit at-or-before the revision ts", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    const v1 = await git.commit("v1");
    // Wait one ms so timestamps don't collide on coarse clocks.
    await new Promise((r) => setTimeout(r, 1100));
    const revisionTs = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 1100));
    await store.writeArtifact(cwd, "T-1", { fm: sample.fm, body: "v2\n" });
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    await git.commit("v2");

    const baseline = await store.findDiffBaseline(cwd, "T-1", "design", revisionTs);
    expect(baseline).toBe(v1.commit);
  });

  it("findDiffBaseline returns null when no commits touch the artifact", async () => {
    const store = new ArtifactsStore();
    expect(await store.findDiffBaseline(cwd, "T-1", "design", null)).toBeNull();
  });

  it("applyHumanEdit replaces body, sets status to human_edited, commits", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "design.md")]);
    await git.commit("seed");

    const { artifact, commitSha } = await store.applyHumanEdit(
      cwd,
      "T-1",
      "design",
      "# Design\n\nuser-authored body\n",
    );
    expect(artifact.fm.status).toBe("human_edited");
    expect(artifact.fm.last_updated_by).toBe("human");
    expect(artifact.body).toBe("# Design\n\nuser-authored body\n");
    expect(commitSha.length).toBeGreaterThan(0);

    // Re-read confirms the disk contents match what was returned.
    const reread = await store.readArtifact(cwd, "T-1", "design");
    expect(reread?.fm.status).toBe("human_edited");
    expect(reread?.body).toBe("# Design\n\nuser-authored body\n");

    // Commit message has the human-attribution prefix the diff endpoint can
    // recognize.
    const log = await git.log();
    expect(log.latest?.message).toContain("human(T-1): edit design.md");
  });

  it("applyHumanEdit throws when the artifact doesn't exist yet", async () => {
    const store = new ArtifactsStore();
    await expect(
      store.applyHumanEdit(cwd, "T-1", "design", "anything"),
    ).rejects.toThrow(/not found/);
  });

  it("listArtifacts returns design then spec when both present", async () => {
    const store = new ArtifactsStore();
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

  it("plan + scenarios round-trip with correct file extensions", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", planSample);
    await store.writeArtifact(cwd, "T-1", scenariosSample);

    const planPath = store.artifactPath(cwd, "T-1", "plan");
    const scenariosPath = store.artifactPath(cwd, "T-1", "scenarios");
    expect(planPath.endsWith("plan.md")).toBe(true);
    expect(scenariosPath.endsWith("scenarios.yaml")).toBe(true);

    const plan = await store.readArtifact(cwd, "T-1", "plan");
    const scenarios = await store.readArtifact(cwd, "T-1", "scenarios");
    expect(plan?.fm.kind).toBe("plan");
    expect(scenarios?.fm.kind).toBe("scenarios");
    expect(scenarios?.body).toContain("scenarios:");
  });

  it("setArtifactStatus on scenarios commits with the .yaml file path", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "scenarios.yaml")]);
    await git.commit("seed");
    const updated = await store.setArtifactStatus(cwd, "T-1", "scenarios", "ready", "plan-agent");
    expect(updated.fm.status).toBe("ready");
    const log = await git.log();
    expect(log.latest?.message).toContain("mark scenarios as ready");
  });

  it("listArtifacts returns all four kinds when present", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    await store.writeArtifact(cwd, "T-1", { fm: { ...sample.fm, kind: "spec", parent: "design.md" }, body: "# Spec\n" });
    await store.writeArtifact(cwd, "T-1", planSample);
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    const list = await store.listArtifacts(cwd, "T-1");
    expect(list.map((a) => a.fm.kind)).toEqual(["design", "spec", "plan", "scenarios"]);
  });

  it("listArtifacts honors a kinds filter", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", sample);
    await store.writeArtifact(cwd, "T-1", planSample);
    const list = await store.listArtifacts(cwd, "T-1", ["plan"]);
    expect(list.map((a) => a.fm.kind)).toEqual(["plan"]);
  });

  it("archiveCurrentRun moves plan artifacts + research/ directory", async () => {
    const store = new ArtifactsStore();
    await store.writeArtifact(cwd, "T-1", planSample);
    await store.writeArtifact(cwd, "T-1", scenariosSample);
    const dir = join(cwd, ".harness", "T-1");
    await writeFile(join(dir, "plan.jsonl"), "{\"kind\":\"x\"}\n");
    await writeFile(join(dir, "pi-session-plan.jsonl"), "session\n");
    await mkdir(join(dir, "research"), { recursive: true });
    await writeFile(join(dir, "research", "codebase-locator.md"), "# findings\n");

    const git = simpleGit(cwd);
    await git.raw(["add", "-f", join(".harness", "T-1", "plan.md"), join(".harness", "T-1", "scenarios.yaml"), join(".harness", "T-1", "plan.jsonl"), join(".harness", "T-1", "pi-session-plan.jsonl")]);
    await git.commit("seed");

    await store.archiveCurrentRun(cwd, "T-1", "r_old");

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, "plan.md"))).toBe(false);
    expect(existsSync(join(dir, "scenarios.yaml"))).toBe(false);
    expect(existsSync(join(dir, "plan.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "pi-session-plan.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "research"))).toBe(false);

    const archive = join(dir, "runs", "r_old");
    expect(existsSync(join(archive, "plan.md"))).toBe(true);
    expect(existsSync(join(archive, "scenarios.yaml"))).toBe(true);
    expect(existsSync(join(archive, "plan.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "pi-session-plan.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "research", "codebase-locator.md"))).toBe(true);
  });
});
