import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: "pnpm --filter @pi-harness/orchestrator dev",
      port: 4000,
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter @pi-harness/dashboard dev",
      port: 3000,
      reuseExistingServer: true,
    },
  ],
});
