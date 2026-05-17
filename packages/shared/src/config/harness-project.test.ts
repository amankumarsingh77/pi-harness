import { describe, expect, it } from "vitest";
import {
  DEFAULT_HARNESS_PROJECT_CONFIG,
  mergeHarnessProjectConfig,
  parseHarnessProjectEnv,
} from "./harness-project.js";

describe("HarnessProjectConfig", () => {
  it("fills omitted project config fields with defaults", () => {
    expect(mergeHarnessProjectConfig({ repoRoot: "/repo" })).toEqual({
      ...DEFAULT_HARNESS_PROJECT_CONFIG,
      repoRoot: "/repo",
      worktreesDir: "/repo/.harness/worktrees",
      stateDir: "/repo/.harness",
    });
  });

  it("keeps explicit worktree and state directories", () => {
    expect(
      mergeHarnessProjectConfig({
        repoRoot: "/repo",
        stateDir: "/tmp/state",
        worktreesDir: "/tmp/worktrees",
      }),
    ).toMatchObject({
      stateDir: "/tmp/state",
      worktreesDir: "/tmp/worktrees",
    });
  });

  it("parses environment overrides using orchestrator-compatible names", () => {
    expect(
      parseHarnessProjectEnv({
        HARNESS_REPO_ROOT: "/external",
        HARNESS_BASE_BRANCH: "trunk",
        HARNESS_STATE_DIR: "/external/.state",
        HARNESS_WORKTREES_DIR: "/external/.state/wt",
        HARNESS_CONTAINER_RUNTIME: "docker",
        DATABASE_URL: "postgresql://user:pass@localhost:5555/db",
        DASHBOARD_PORT: "3100",
        PORT: "4100",
        PI_WEB_PROVIDER: "searxng",
      }),
    ).toEqual({
      repoRoot: "/external",
      baseBranch: "trunk",
      stateDir: "/external/.state",
      worktreesDir: "/external/.state/wt",
      containerRuntime: "docker",
      databaseUrl: "postgresql://user:pass@localhost:5555/db",
      dashboardPort: 3100,
      orchestratorPort: 4100,
      webProvider: "searxng",
    });
  });
});
