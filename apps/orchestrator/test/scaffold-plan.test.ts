import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { scaffoldPlan } from "../src/runner/scaffold-plan.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "scaffold-plan-test-"));
  const git = simpleGit(scratch);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  // Mirror the real harness layout: root .gitignore excludes `.harness/`.
  // scaffoldPlan must force-add anyway.
  await writeFile(join(scratch, ".gitignore"), ".harness/\n");
  await writeFile(join(scratch, "README.md"), "init\n");
  await git.add(["README.md", ".gitignore"]);
  await git.commit("init");
  await git.checkoutLocalBranch("pi/T-001");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("scaffoldPlan", () => {
  it("writes plan.md and scenarios.yaml with draft frontmatter", async () => {
    const r = await scaffoldPlan({ cwd: scratch, taskId: "T-001", branch: "pi/T-001" });
    expect(r.created).toBe(true);

    const plan = await readFile(join(scratch, ".harness", "T-001", "plan.md"), "utf8");
    expect(plan).toMatch(/^---\n/);
    expect(plan).toContain("task: T-001");
    expect(plan).toContain("kind: plan");
    expect(plan).toContain("parent: design.md");
    expect(plan).toContain("status: draft");
    expect(plan).toContain("branch: pi/T-001");

    const scenarios = await readFile(
      join(scratch, ".harness", "T-001", "scenarios.yaml"),
      "utf8",
    );
    expect(scenarios).toContain("kind: scenarios");
    expect(scenarios).toContain("parent: plan.md");
    expect(scenarios).toContain("status: draft");
    expect(scenarios).toContain("scenarios: []");
  });

  it("writes a per-task .gitignore that excludes research/", async () => {
    await scaffoldPlan({ cwd: scratch, taskId: "T-001", branch: "pi/T-001" });
    const ignored = await readFile(join(scratch, ".harness", "T-001", ".gitignore"), "utf8");
    expect(ignored.trim()).toBe("research/");
  });

  it("research/ files inside the per-task dir are gitignored after scaffold", async () => {
    await scaffoldPlan({ cwd: scratch, taskId: "T-001", branch: "pi/T-001" });
    const researchDir = join(scratch, ".harness", "T-001", "research");
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, "codebase-locator.md"), "# codebase-locator findings\n");
    const git = simpleGit(scratch);
    const status = await git.status();
    // .harness/T-001/research/* should NOT appear in status — neither staged
    // nor untracked. The per-task .gitignore takes effect even though the
    // root .gitignore had to be force-bypassed for the rest of the dir.
    expect(status.not_added.some((p) => p.includes("research/"))).toBe(false);
    expect(status.staged.some((p) => p.includes("research/"))).toBe(false);
  });

  it("commits with chore(<taskId>): plan scaffolding subject", async () => {
    await scaffoldPlan({ cwd: scratch, taskId: "T-002", branch: "pi/T-002" });
    const git = simpleGit(scratch);
    const log = await git.log();
    expect(log.latest?.message).toBe("chore(T-002): plan scaffolding");
  });

  it("is idempotent — second call is a no-op", async () => {
    const first = await scaffoldPlan({ cwd: scratch, taskId: "T-003", branch: "pi/T-003" });
    expect(first.created).toBe(true);
    const second = await scaffoldPlan({ cwd: scratch, taskId: "T-003", branch: "pi/T-003" });
    expect(second.created).toBe(false);
    const git = simpleGit(scratch);
    const log = await git.log();
    const scaffoldCommits = log.all.filter((c) => c.message.includes("plan scaffolding"));
    expect(scaffoldCommits).toHaveLength(1);
  });
});
