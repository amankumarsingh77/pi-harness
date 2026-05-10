import { defineConfig } from "vitest/config";

// Live smoke runner. Mirrors vitest.config.ts but drops the *.live.test.ts
// exclude so PI_LIVE=1 runs can find the live files. Used only for manual
// smoke testing — never wired into pnpm test.
export default defineConfig({
  test: {
    testTimeout: 15000,
    environment: "node",
    setupFiles: [],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.harness/**"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
