import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    environment: "node",
    setupFiles: [],
    // Live smoke tests (PI_LIVE=1 pnpm ... test brainstorm.live) hit a real
    // LLM and cost money. Excluded from default test runs; the `live` filename
    // suffix opts a file out of CI.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.live.test.ts",
      // Per-task worktrees scaffolded by the orchestrator at runtime carry
      // their own copies of every package. Without this, vitest discovers
      // and re-runs the dashboard's tests through every leftover worktree.
      "**/.harness/**",
    ],
    // DB-backed tests share a single Postgres; running test files in parallel
    // causes cross-file truncates to wipe in-flight rows. Serialize.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
