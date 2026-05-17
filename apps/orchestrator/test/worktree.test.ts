import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { WorktreeManager } from "../src/adapters/worktree.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "wt-test-"));
  // initialize a bare-ish source repo
  const repo = join(scratch, "repo");
  await mkdir(repo, { recursive: true });
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  // Need an initial commit so worktree creation works.
  await writeFile(join(repo, "README.md"), "init");
  await git.add("README.md");
  await git.commit("init");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("WorktreeManager", () => {
  it("create() anchors new worktrees to the configured base branch", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const git = simpleGit(repo);
    const originalBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    await git.checkoutLocalBranch("trunk");
    await writeFile(join(repo, "trunk.txt"), "from trunk");
    await git.add("trunk.txt");
    await git.commit("trunk commit");
    await git.checkout(originalBranch);
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir, baseBranch: "trunk" });

    const wt = await wm.create("task-trunk", "feat/trunk");

    const wtGit = simpleGit(wt.path);
    const hasTrunkFile = await wtGit.raw(["ls-tree", "--name-only", "HEAD"]);
    expect(hasTrunkFile).toContain("trunk.txt");
  });

  it("create() makes a worktree at the configured path with a new branch", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    const wt = await wm.create("task-1", "feat/test");
    expect(wt.path).toBe(join(wtDir, "task-1"));
    expect(wt.branch).toBe("feat/test");

    // Worktree's HEAD is the new branch
    const wtGit = simpleGit(wt.path);
    const head = await wtGit.revparse(["--abbrev-ref", "HEAD"]);
    expect(head.trim()).toBe("feat/test");
  });

  it("remove() deletes the worktree", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    await wm.create("task-2", "feat/two");
    await wm.remove("task-2");

    const list = await wm.list();
    expect(list.find((w) => w.taskId === "task-2")).toBeUndefined();
  });

  it("ensure() returns existing worktree without erroring", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    const first = await wm.ensure("task-e", "pi/task-e");
    const second = await wm.ensure("task-e", "pi/task-e");
    expect(second.path).toBe(first.path);
    const list = await wm.list();
    expect(list.filter((w) => w.taskId === "task-e")).toHaveLength(1);
  });

  it("ensure() creates worktree when absent", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    const wt = await wm.ensure("task-new", "pi/task-new");
    expect(wt.taskId).toBe("task-new");
    expect(wt.branch).toBe("pi/task-new");
  });

  it("list() returns all known worktrees", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    await wm.create("a", "feat/a");
    await wm.create("b", "feat/b");

    const list = await wm.list();
    const ids = list.map((w) => w.taskId).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});
