import { defineConfig, devices } from "@playwright/test";

const dashboardPort = Number(process.env.DASHBOARD_E2E_PORT ?? "3000");
const orchestratorPort = Number(process.env.ORCHESTRATOR_E2E_PORT ?? "4000");
const dashboardUrl = process.env.DASHBOARD_E2E_BASE_URL ?? `http://localhost:${dashboardPort}`;
const orchestratorUrl =
  process.env.ORCHESTRATOR_E2E_BASE_URL ?? `http://localhost:${orchestratorPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: dashboardUrl, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: `PORT=${orchestratorPort} pnpm --filter @pi-harness/orchestrator dev`,
      port: orchestratorPort,
      reuseExistingServer: true,
    },
    {
      command: `ORCHESTRATOR_URL=${orchestratorUrl} pnpm --filter @pi-harness/dashboard exec next dev -p ${dashboardPort}`,
      port: dashboardPort,
      reuseExistingServer: true,
    },
  ],
});
