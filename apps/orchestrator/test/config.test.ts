import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("anchors default relative paths to the git repository root", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "orchestrator-config-"));
    try {
      const repo = join(scratch, "repo");
      const orchestratorDir = join(repo, "apps", "orchestrator");
      await mkdir(orchestratorDir, { recursive: true });
      await writeFile(join(repo, "README.md"), "init\n");
      const git = simpleGit(repo);
      await git.init();

      const config = loadConfig({}, orchestratorDir);
      const canonicalRepo = await realpath(repo);

      expect(config.repoRoot).toBe(canonicalRepo);
      expect(config.stateDir).toBe(join(canonicalRepo, ".harness"));
      expect(config.runsDir).toBe(join(canonicalRepo, ".harness", "runs"));
      expect(config.worktreesDir).toBe(join(canonicalRepo, ".harness", "worktrees"));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
