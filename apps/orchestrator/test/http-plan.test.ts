import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import simpleGit from "simple-git";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { ArtifactsStore } from "../src/agents/artifacts-store.js";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { CancellationRegistry } from "../src/runner/cancellation.js";
import type { ArtifactStatus } from "@pi-harness/shared";

const validScenariosBody = `scenarios:
  - id: s1
    type: api
    name: smoke
    request:
      method: GET
      url: http://localhost/health
    expect:
      status: 200
`;

const validPlanBody = [
  "## Goal",
  "x",
  "## Patterns to follow",
  "- p",
  "## Touchpoints",
  "- t",
  "## Blast radius",
  "- b",
  "## Precedent warnings",
  "- w",
  "## Steps",
  "1. step",
  "## Out of scope",
  "- o",
].join("\n");

async function makePlanWorktree(
  taskId: string,
  planStatus: ArtifactStatus,
  scenariosStatus: ArtifactStatus,
): Promise<string> {
  const wt = await mkdtemp(join(tmpdir(), "pi-harness-plan-route-"));
  const git = simpleGit(wt);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(wt, ".gitignore"), ".harness/\n");
  await writeFile(join(wt, "README.md"), "init\n");
  await git.add(["README.md", ".gitignore"]);
  await git.commit("init");
  await git.checkoutLocalBranch(`pi/${taskId}`);
  await mkdir(join(wt, ".harness", taskId), { recursive: true });
  const store = new ArtifactsStore();
  await store.writeArtifact(wt, taskId, {
    fm: {
      task: taskId,
      kind: "plan",
      parent: "design.md",
      branch: `pi/${taskId}`,
      status: planStatus,
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body: validPlanBody,
  });
  await store.writeArtifact(wt, taskId, {
    fm: {
      task: taskId,
      kind: "scenarios",
      parent: "plan.md",
      branch: `pi/${taskId}`,
      status: scenariosStatus,
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body: validScenariosBody,
  });
  await store.writeArtifact(wt, taskId, {
    fm: {
      task: taskId,
      kind: "blast-radius",
      parent: "spec.md",
      branch: `pi/${taskId}`,
      status: scenariosStatus,
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body: `items:
  - id: BR-001
    requirementRefs:
      - REQ-001
    surface: api
    title: Plan route impact
    risk: medium
    touchpoints:
      - path: apps/orchestrator/src/http/routes/plan.ts
        role: change
        note: Plan bundle surfaces blast radius.
    inbound: []
    outbound: []
    precedentRefs: []
    verificationRefs: []
`,
  });
  await git.raw(["add", "-f", ".harness"]);
  await git.commit("seed plan");
  return wt;
}

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";

describe("http /api/tasks/:id/plan routes", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const cancellation = new CancellationRegistry();
  const app = buildServer({ runs, events, runsDir: tmpdir(), cancellation });

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("GET returns null artifacts when task has no worktree", async () => {
    const t = await runs.createTask({ title: "x" });
    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/plan` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gate).toBe("running");
    expect(body.plan).toBeNull();
    expect(body.scenarios).toBeNull();
    expect(body.blastRadius).toBeNull();
    expect(body.research["codebase-scout"]).toBeNull();
  });

  it("GET surfaces plan, scenarios, gate, and research findings", async () => {
    const t = await runs.createTask({ title: "y" });
    const wt = await makePlanWorktree(t.id, "ready", "ready");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    // Drop a fake findings file.
    const researchDir = join(wt, ".harness", t.id, "research");
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, "codebase-scout.md"), "# codebase-scout findings\n");

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/plan` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gate).toBe("awaiting_user");
    expect(body.plan?.fm.status).toBe("ready");
    expect(body.scenarios?.fm.status).toBe("ready");
    expect(body.blastRadius?.fm.status).toBe("ready");
    expect(body.blastRadius?.body).toContain("BR-001");
    expect(body.research["codebase-scout"]).toContain("codebase-scout findings");
    expect(body.research["integration-scanner"]).toBeNull();
  });

  it("user_request_plan_changes resets artifacts to draft + writes revision event", async () => {
    const t = await runs.createTask({ title: "rev" });
    const wt = await makePlanWorktree(t.id, "ready", "ready");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    await runs.createRun({ taskId: t.id, phase: "plan" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: {
        type: "user_request_plan_changes",
        comment: "tighten the scope and remove the OOB step",
      },
    });
    expect(res.statusCode).toBe(200);

    const store = new ArtifactsStore();
    const plan = await store.readArtifact(wt, t.id, "plan");
    const scenarios = await store.readArtifact(wt, t.id, "scenarios");
    expect(plan?.fm.status).toBe("draft");
    expect(scenarios?.fm.status).toBe("draft");

    const jsonl = await readFile(join(wt, ".harness", t.id, "plan.jsonl"), "utf8");
    expect(jsonl).toContain("plan_revision_requested");
    expect(jsonl).toContain("tighten the scope");
  });

  it("user_request_plan_changes returns 409 when gate is closed", async () => {
    const t = await runs.createTask({ title: "rev2" });
    const wt = await makePlanWorktree(t.id, "draft", "draft");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: {
        type: "user_request_plan_changes",
        comment: "this should be rejected",
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("user_approve_plan moves planning → executing and settles the active run", async () => {
    const t = await runs.createTask({ title: "appr" });
    const wt = await makePlanWorktree(t.id, "ready", "ready");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    await runs.createRun({ taskId: t.id, phase: "plan" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_approve_plan" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe("executing");

    const updated = await runs.findActiveRun(t.id, "plan");
    expect(updated).toBeNull(); // active = running; settled run no longer matches
  });

  it("plan/artifact edit flips plan.md to human_edited", async () => {
    const t = await runs.createTask({ title: "edit" });
    const wt = await makePlanWorktree(t.id, "draft", "draft");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/plan/artifact`,
      payload: { kind: "plan", body: "# edited\n\nbody\n" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const store = new ArtifactsStore();
    const plan = await store.readArtifact(wt, t.id, "plan");
    expect(plan?.fm.status).toBe("human_edited");
    expect(plan?.body.trim()).toBe("# edited\n\nbody".trim());
  });
});
