import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { scaffoldBrainstorm } from "../src/runner/scaffold-brainstorm.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "scaffold-test-"));
  const git = simpleGit(scratch);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(scratch, "README.md"), "init\n");
  await git.add("README.md");
  await git.commit("init");
  // Need to be on a real branch (not detached) for commits to land somewhere
  await git.checkoutLocalBranch("pi/T-001");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("scaffoldBrainstorm", () => {
  it("writes design.md and spec.md with draft frontmatter", async () => {
    const r = await scaffoldBrainstorm({ cwd: scratch, taskId: "T-001", branch: "pi/T-001" });
    expect(r.created).toBe(true);

    const design = await readFile(join(scratch, ".harness", "T-001", "design.md"), "utf8");
    expect(design).toMatch(/^---\n/);
    expect(design).toContain("task: T-001");
    expect(design).toContain("kind: design");
    expect(design).toContain("parent: null");
    expect(design).toContain("status: draft");
    expect(design).toContain("branch: pi/T-001");
    expect(design).toContain("last_updated_by: orchestrator");

    const spec = await readFile(join(scratch, ".harness", "T-001", "spec.md"), "utf8");
    expect(spec).toContain("kind: spec");
    expect(spec).toContain("parent: design.md");
    expect(spec).toContain("status: draft");
  });

  it("commits with the chore(<taskId>): brainstorm scaffolding subject", async () => {
    await scaffoldBrainstorm({ cwd: scratch, taskId: "T-002", branch: "pi/T-002" });
    const git = simpleGit(scratch);
    const log = await git.log();
    expect(log.latest?.message).toBe("chore(T-002): brainstorm scaffolding");
  });

  it("is idempotent — second call is a no-op", async () => {
    const first = await scaffoldBrainstorm({ cwd: scratch, taskId: "T-003", branch: "pi/T-003" });
    expect(first.created).toBe(true);

    const second = await scaffoldBrainstorm({ cwd: scratch, taskId: "T-003", branch: "pi/T-003" });
    expect(second.created).toBe(false);

    const git = simpleGit(scratch);
    const log = await git.log();
    // Only one scaffolding commit should exist
    const scaffoldCommits = log.all.filter((c) => c.message.includes("brainstorm scaffolding"));
    expect(scaffoldCommits).toHaveLength(1);
  });
});
