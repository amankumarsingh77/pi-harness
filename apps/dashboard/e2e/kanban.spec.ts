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
  await expect(card.getByText("Urgent")).toBeVisible();
  await expect(card.getByText("bug-fix")).toBeVisible();
  await expect(card.getByText("needs-design")).toBeVisible();
});

test("dragging backlog card to Brainstorming starts the phase", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: orchestratorUrl });
  const created = await api.post("/api/tasks", { data: { title: "e2e-drag-to-brainstorm" } });
  expect(created.ok()).toBeTruthy();
  const task = await created.json();

  await page.goto("/");
  const card = page.getByTestId(`task-card-${task.id}`);
  await expect(card).toBeAttached();
  await expect(card).toBeVisible();
  await page.evaluate((taskId) => {
    const cardNode = document.querySelector(`[data-testid="task-card-${taskId}"]`);
    const dropNode = document.querySelector('[data-testid="kanban-column-brainstorming"]');
    if (!cardNode || !dropNode) throw new Error("missing drag source or drop target");
    const dataTransfer = new DataTransfer();
    cardNode.dispatchEvent(new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    dropNode.dispatchEvent(new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
    dropNode.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }));
  }, task.id);

  await expect(card.getByText("e2e-drag-to-brainstorm")).toBeVisible();
  await expect.poll(async () => {
    const response = await api.get(`/api/tasks/${task.id}`);
    return (await response.json()).task.status;
  }).toBe("brainstorming");
});
