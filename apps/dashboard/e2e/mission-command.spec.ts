import { test, expect, request as apiRequest } from "@playwright/test";

const dashboardPort = process.env.DASHBOARD_E2E_PORT ?? "3000";
const dashboardUrl =
  process.env.DASHBOARD_E2E_BASE_URL ?? `http://localhost:${dashboardPort}`;

test("Mission Command opens from task detail and updates mission live", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: dashboardUrl });
  const created = await api.post("/api/proxy/tasks", {
    data: {
      title: "e2e-mission-command",
      description: "Mission Command smoke test",
    },
  });
  const createdBody = await created.text();
  expect(created.ok(), createdBody).toBeTruthy();
  const task = JSON.parse(createdBody) as { id: string };

  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("link", { name: "Mission Command" }).click();

  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}/mission$`));
  await expect(page.getByRole("heading", { name: "e2e-mission-command" })).toBeVisible();

  const patched = await api.patch(`/api/proxy/tasks/${task.id}/mission`, {
    data: { goal: "Live mission smoke goal" },
  });
  const patchedBody = await patched.text();
  expect(patched.ok(), patchedBody).toBeTruthy();

  await expect(page.getByText("Live mission smoke goal")).toBeVisible();
  await expect(page.getByText("Mission updated")).toBeVisible();
});
