import { test, expect, request as apiRequest } from "@playwright/test";

test("kanban shows a freshly created task in Backlog", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: "http://localhost:4000" });
  const created = await api.post("/api/tasks", { data: { title: "e2e-kanban-task" } });
  expect(created.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByText("e2e-kanban-task")).toBeVisible();
  await expect(page.getByText("Backlog")).toBeVisible();
});
