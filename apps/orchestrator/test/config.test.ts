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
      expect(config.graphify).toEqual({
        enabled: true,
        bootstrap: true,
        bootBlock: false,
        minVersion: "0.8.32",
        bin: "graphify",
        queryBudget: 2000,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("loads Graphify harness integration settings from environment", () => {
    const config = loadConfig({
      HARNESS_GRAPHIFY_ENABLED: "false",
      HARNESS_GRAPHIFY_BOOTSTRAP: "false",
      HARNESS_GRAPHIFY_BOOT_BLOCK: "true",
      HARNESS_GRAPHIFY_MIN_VERSION: "0.9.0",
      HARNESS_GRAPHIFY_BIN: "/tmp/graphify",
      HARNESS_GRAPHIFY_QUERY_BUDGET: "800",
    }, "/tmp/repo");

    expect(config.graphify).toEqual({
      enabled: false,
      bootstrap: false,
      bootBlock: true,
      minVersion: "0.9.0",
      bin: "/tmp/graphify",
      queryBudget: 800,
    });
  });
});
