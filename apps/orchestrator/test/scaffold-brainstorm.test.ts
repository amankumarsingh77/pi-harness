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
    expect(design).toContain("## Problem");
    expect(design).toContain("## Context");
    expect(design).toContain("## Requirements");
    expect(design).toContain("## Architectural Decisions");
    expect(design).toContain("## Approaches Considered");
    expect(design).toContain("## Data Shapes / Contracts");
    expect(design).toContain("## Architecture");
    expect(design).toContain("## External Dependencies & Fallback Chain");
    expect(design).toContain("## Risks & Mitigations");
    expect(design).toContain("## Assumptions");
    expect(design).toContain("## Open Questions");
    expect(design).toContain("## What This Does NOT Do");

    const spec = await readFile(join(scratch, ".harness", "T-001", "spec.md"), "utf8");
    expect(spec).toContain("kind: spec");
    expect(spec).toContain("parent: design.md");
    expect(spec).toContain("status: draft");
    expect(spec).toContain("## Glossary");
    expect(spec).toContain("## Requirements");
    expect(spec).toContain("## Edge Cases");
    expect(spec).toContain("## Verification Matrix");
    expect(spec).toContain("## Verification scenarios");
    expect(spec).toContain("## Out of Scope");
  });

  it("does not commit generated brainstorm artifacts", async () => {
    await scaffoldBrainstorm({ cwd: scratch, taskId: "T-002", branch: "pi/T-002" });
    const git = simpleGit(scratch);
    const log = await git.log();
    expect(log.latest?.message).toBe("init");
  });

  it("is idempotent — second call is a no-op", async () => {
    const first = await scaffoldBrainstorm({ cwd: scratch, taskId: "T-003", branch: "pi/T-003" });
    expect(first.created).toBe(true);

    const second = await scaffoldBrainstorm({ cwd: scratch, taskId: "T-003", branch: "pi/T-003" });
    expect(second.created).toBe(false);

    const git = simpleGit(scratch);
    const log = await git.log();
    const scaffoldCommits = log.all.filter((c) => c.message.includes("brainstorm scaffolding"));
    expect(scaffoldCommits).toHaveLength(0);
  });
});
