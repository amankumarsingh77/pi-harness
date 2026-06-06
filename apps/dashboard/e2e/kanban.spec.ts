import { test, expect, request as apiRequest, type Locator, type Page } from "@playwright/test";

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

test("clicking a backlog card opens the task detail page", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-click-card" } });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();

  await page.goto("/");
  await page.getByTestId(`task-card-${task.id}`).click();

  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(page.getByText("e2e-click-card")).toBeVisible();
});

test("dragging backlog card to Brainstorming starts the phase", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-drag-to-brainstorm" } });
  expect(created.ok()).toBeTruthy();

  await page.goto("/");
  const card = page.getByTestId("kanban-column-backlog").locator("[data-testid^='task-card-']").first();
  const target = page.getByTestId("kanban-column-brainstorming");
  await expect(card).toBeAttached();
  await expect(card).toBeVisible();
  const href = await card.getByRole("link", { name: /^Open / }).getAttribute("href");
  const taskId = href?.split("/").at(-1);
  if (!taskId) throw new Error("Missing task id in card link");

  await dragToColumn(page, card, target);

  await expect(page).toHaveURL(/\/$/);
  await expect.poll(async () => {
    const response = await api.get(`/api/tasks/${taskId}`);
    return (await response.json()).task.status;
  }).toBe("brainstorming");
});

test("dragging and releasing away from a drop target stays on the board", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-drag-release-away" } });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();

  await page.goto("/");
  const card = page.getByTestId(`task-card-${task.id}`);
  await expect(card).toBeVisible();

  await dragAwayFromDropTargets(page, card);

  await expect(page).toHaveURL(/\/$/);
  const response = await api.get(`/api/tasks/${task.id}`);
  expect((await response.json()).task.status).toBe("backlog");
});

test("starting backlog card from the accessible action starts the phase", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-action-to-brainstorm" } });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();

  await page.goto("/");
  const card = page.getByTestId(`task-card-${task.id}`);
  await card.getByRole("button", { name: "Start brainstorm for e2e-action-to-brainstorm" }).click();

  await expect.poll(async () => {
    const response = await api.get(`/api/tasks/${task.id}`);
    return (await response.json()).task.status;
  }).toBe("brainstorming");
});

async function dragToColumn(
  page: Page,
  card: Locator,
  target: Locator,
): Promise<void> {
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error("Missing drag geometry");

  const start = {
    x: cardBox.x + cardBox.width / 2,
    y: cardBox.y + 14,
  };
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + 64,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function dragAwayFromDropTargets(page: Page, card: Locator): Promise<void> {
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("Missing drag geometry");

  const start = {
    x: cardBox.x + cardBox.width / 2,
    y: cardBox.y + 14,
  };
  const end = {
    x: start.x,
    y: start.y + 40,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}
