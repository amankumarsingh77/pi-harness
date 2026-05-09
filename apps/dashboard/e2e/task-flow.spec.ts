import { test, expect, request as apiRequest } from "@playwright/test";

test("create task → start brainstorm transition", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: "http://localhost:4000" });
  const created = await api.post("/api/tasks", { data: { title: "e2e-flow-task" } });
  const task = await created.json();

  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText("e2e-flow-task")).toBeVisible();
  await expect(page.getByText(/PHASE TIMELINE/)).toBeVisible();
});
