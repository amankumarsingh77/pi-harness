import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    environment: "node",
    setupFiles: [],
    // DB-backed tests share a single Postgres; running test files in parallel
    // causes cross-file truncates to wipe in-flight rows. Serialize.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
