import { test, expect, request as apiRequest } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

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

test("Mission Command runs verifier sidecar and updates claims live", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: dashboardUrl });
  const created = await api.post("/api/proxy/tasks", {
    data: {
      title: "e2e-verifier-sidecar",
      description: "Verifier sidecar smoke test",
    },
  });
  const createdBody = await created.text();
  expect(created.ok(), createdBody).toBeTruthy();
  const task = JSON.parse(createdBody) as { id: string };

  const started = await api.post(`/api/proxy/tasks/${task.id}/transitions`, {
    data: { type: "user_start_brainstorm", workflow: "backend-feature" },
  });
  const startedBody = await started.text();
  expect(started.ok(), startedBody).toBeTruthy();

  await expect.poll(async () => {
    const response = await api.get(`/api/proxy/tasks/${task.id}`);
    const body = await response.json() as { task: { worktreePath: string | null } };
    return body.task.worktreePath ?? "";
  }, { timeout: 15_000 }).not.toBe("");

  const detail = await api.get(`/api/proxy/tasks/${task.id}`);
  const detailBody = await detail.json() as { task: { worktreePath: string | null } };
  const worktreePath = detailBody.task.worktreePath;
  if (!worktreePath) throw new Error("expected worktree path");
  await seedScenarioClaim({ taskId: task.id, worktreePath, scenarioId: "S-e2e-verifier" });

  await page.goto(`/tasks/${task.id}/mission`);
  await expect(page.getByText("Scenario e2e verifier must pass")).toBeVisible();

  await page.getByRole("button", { name: "Run verifier" }).click();

  await expect(page.getByText("Scenario passed: e2e verifier scenario")).toBeVisible();
  await expect(page.getByText("proven").first()).toBeVisible();
  await expect(page.getByText(/Claim claim_.* marked proven/)).toBeVisible();
});

async function seedScenarioClaim(opts: {
  readonly taskId: string;
  readonly worktreePath: string;
  readonly scenarioId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await mkdir(join(opts.worktreePath, ".harness", opts.taskId), { recursive: true });
  await writeFile(
    join(opts.worktreePath, ".harness", opts.taskId, "scenarios.yaml"),
    [
      "---",
      `task: ${opts.taskId}`,
      "kind: scenarios",
      "parent: plan.md",
      "status: ready",
      `branch: pi/${opts.taskId}`,
      `last_updated: "${now}"`,
      "last_updated_by: e2e",
      "---",
      "scenarios:",
      `  - id: ${opts.scenarioId}`,
      "    type: api",
      "    name: e2e verifier scenario",
      "    request:",
      "      method: GET",
      "      url: /healthz",
      "    expect:",
      "      status: 200",
      "",
    ].join("\n"),
    "utf8",
  );

  const stateDir = resolve(process.cwd(), "../orchestrator/.harness", "tasks", opts.taskId);
  await mkdir(stateDir, { recursive: true });
  const sourceKey = `scenario:${opts.scenarioId}`;
  await writeFile(
    join(stateDir, "claims.jsonl"),
    `${JSON.stringify({
      type: "claim.created",
      claimId: claimIdForSourceKey(opts.taskId, sourceKey),
      taskId: opts.taskId,
      sourceKey,
      text: "Scenario e2e verifier must pass",
      owner: "planner",
      source: "plan",
      createdAt: now,
    })}\n`,
    "utf8",
  );
}

function claimIdForSourceKey(taskId: string, sourceKey: string): string {
  const digest = createHash("sha256")
    .update(taskId)
    .update("\u0000")
    .update(sourceKey)
    .digest("base64url")
    .slice(0, 16);
  return `claim_${digest}`;
}
