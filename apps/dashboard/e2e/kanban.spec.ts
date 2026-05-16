import { test, expect, request as apiRequest } from "@playwright/test";

const orchestratorUrl = process.env.ORCHESTRATOR_E2E_BASE_URL ?? "http://localhost:4000";

test("kanban shows a freshly created task in Backlog", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", {
    data: {
      title: "e2e-kanban-task",
      priority: "urgent",
      tags: ["Bug Fix", "needs design"],
    },
  });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();

  await page.goto("/");
  const card = page.getByTestId(`task-card-${task.id}`);
  await expect(card.getByText("e2e-kanban-task")).toBeVisible();
  await expect(page.getByTestId("kanban-column-backlog").getByText("Backlog")).toBeVisible();
  await expect(card.getByText("▲")).toBeVisible();
  await expect(card.getByRole("button", { name: /drag .* to brainstorming/i })).toHaveCount(0);
});

test("dragging backlog card to Brainstorming starts the phase", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-drag-to-brainstorm" } });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();

  await page.goto("/");
  const card = page.getByTestId(`task-card-${task.id}`);
  const target = page.getByTestId("kanban-column-brainstorming");
  await expect(card).toBeAttached();
  await expect(card).toBeVisible();
  await card.dragTo(target);

  await expect(card.getByText("e2e-drag-to-brainstorm")).toBeVisible();
  await expect.poll(async () => {
    const response = await api.get(`/api/tasks/${task.id}`);
    return (await response.json()).task.status;
  }).toBe("brainstorming");
});
