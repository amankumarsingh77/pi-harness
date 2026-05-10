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
});
