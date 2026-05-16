import { test, expect, request as apiRequest } from "@playwright/test";

const orchestratorUrl = process.env.ORCHESTRATOR_E2E_BASE_URL ?? "http://localhost:4000";

test("create task → start brainstorm transition", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-flow-task" } });
  const task = await created.json();

  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText("e2e-flow-task")).toBeVisible();
  await expect(page.getByText(/PHASE TIMELINE/)).toBeVisible();
});
