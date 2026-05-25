import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import simpleGit from "simple-git";
import { ArtifactsStore } from "../src/agents/artifacts-store.js";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { CancellationRegistry } from "../src/runner/cancellation.js";
import type { Artifact, ArtifactKind, ArtifactStatus } from "@pi-harness/shared";
import { createBareTestStores, resetTestStore } from "./helpers/stores.js";

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

const validExecutionDagBody = `version: 1
nodes:
  - id: C-001
    title: Plan route impact
    phase: Foundation
    kind: api
    lane: orchestrator
    safety: exclusive
    dependsOn: []
    writes:
      - apps/orchestrator/src/http/routes/plan.ts
    reads:
      - apps/orchestrator/src/agents/artifacts-store.ts
    verifies:
      - pnpm --filter @pi-harness/orchestrator test http-plan
    covers:
      - REQ-001
    blastRadius:
      - BR-001
    assertion: Plan bundle includes executionDag.
`;

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
      kind: "design",
      parent: null,
      branch: `pi/${taskId}`,
      status: "approved",
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body: "# Design\n",
  });
  await store.writeArtifact(wt, taskId, {
    fm: {
      task: taskId,
      kind: "spec",
      parent: "design.md",
      branch: `pi/${taskId}`,
      status: "approved",
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body: "# Spec\n",
  });
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
  await store.writeArtifact(wt, taskId, {
    fm: {
      task: taskId,
      kind: "execution-dag",
      parent: "plan.md",
      branch: `pi/${taskId}`,
      status: scenariosStatus,
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body: validExecutionDagBody,
  });
  await git.raw(["add", "-f", ".harness"]);
  await git.commit("seed plan");
  return wt;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

class ObservedArtifactsStore extends ArtifactsStore {
  private activeMutations = 0;
  maxConcurrentMutations = 0;

  override async archiveCurrentRun(
    cwd: string,
    taskId: string,
    runId: string,
    phase: "brainstorm" | "plan",
  ): Promise<void> {
    return this.observeMutation(() => super.archiveCurrentRun(cwd, taskId, runId, phase));
  }

  override async applyHumanEdit(
    cwd: string,
    taskId: string,
    kind: ArtifactKind,
    body: string,
  ): Promise<{ artifact: Artifact; commitSha: string }> {
    return this.observeMutation(() => super.applyHumanEdit(cwd, taskId, kind, body));
  }

  private async observeMutation<T>(fn: () => Promise<T>): Promise<T> {
    this.activeMutations += 1;
    this.maxConcurrentMutations = Math.max(this.maxConcurrentMutations, this.activeMutations);
    await sleep(25);
    try {
      return await fn();
    } finally {
      this.activeMutations -= 1;
    }
  }
}

describe("http /api/tasks/:id/plan routes", () => {
  const { stateDir, runs, events } = createBareTestStores();
  const cancellation = new CancellationRegistry();
  const app = buildServer({ runs, events, runsDir: tmpdir(), cancellation });

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await resetTestStore(stateDir);
  });

  afterAll(async () => {
    await app.close();
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
    expect(body.executionDag).toBeNull();
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
    expect(body.executionDag?.fm.status).toBe("ready");
    expect(body.executionDag?.body).toContain("C-001");
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
    const executionDag = await store.readArtifact(wt, t.id, "execution-dag");
    expect(plan?.fm.status).toBe("draft");
    expect(scenarios?.fm.status).toBe("draft");
    expect(executionDag?.fm.status).toBe("draft");

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

  it("plan restart archives only plan-owned artifacts and preserves brainstorm inputs", async () => {
    const t = await runs.createTask({ title: "restart-plan" });
    const wt = await makePlanWorktree(t.id, "ready", "ready");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    const activeRun = await runs.createRun({ taskId: t.id, phase: "plan" });
    const dir = join(wt, ".harness", t.id);
    await writeFile(join(dir, "plan.jsonl"), "{\"kind\":\"old\"}\n");
    await writeFile(join(dir, "pi-session-plan.jsonl"), "session\n");
    await mkdir(join(dir, "research"), { recursive: true });
    await writeFile(join(dir, "research", "codebase-scout.md"), "# findings\n");

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/plan/restart`,
      payload: { note: "Keep the plan narrower this time." },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, archivedRunId: activeRun.id });
    expect(existsSync(join(dir, "design.md"))).toBe(true);
    expect(existsSync(join(dir, "spec.md"))).toBe(true);
    expect(existsSync(join(dir, "plan.md"))).toBe(true);
    expect(existsSync(join(dir, "scenarios.yaml"))).toBe(true);
    expect(existsSync(join(dir, "blast-radius.yaml"))).toBe(true);
    expect(existsSync(join(dir, "execution-dag.yaml"))).toBe(true);

    const archive = join(dir, "runs", activeRun.id);
    expect(existsSync(join(archive, "design.md"))).toBe(false);
    expect(existsSync(join(archive, "spec.md"))).toBe(false);
    expect(existsSync(join(archive, "plan.md"))).toBe(true);
    expect(existsSync(join(archive, "scenarios.yaml"))).toBe(true);
    expect(existsSync(join(archive, "blast-radius.yaml"))).toBe(true);
    expect(existsSync(join(archive, "execution-dag.yaml"))).toBe(true);
    expect(existsSync(join(archive, "plan.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "pi-session-plan.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "research", "codebase-scout.md"))).toBe(true);

    const store = new ArtifactsStore();
    const plan = await store.readArtifact(wt, t.id, "plan");
    const scenarios = await store.readArtifact(wt, t.id, "scenarios");
    const blastRadius = await store.readArtifact(wt, t.id, "blast-radius");
    const executionDag = await store.readArtifact(wt, t.id, "execution-dag");
    expect(plan?.fm.status).toBe("draft");
    expect(scenarios?.fm.status).toBe("draft");
    expect(blastRadius?.fm.status).toBe("draft");
    expect(executionDag?.fm.status).toBe("draft");

    const newJsonl = await readFile(join(dir, "plan.jsonl"), "utf8");
    expect(newJsonl).toContain("session_reset");
    expect(newJsonl).toContain("Keep the plan narrower this time.");
  });

  it("plan restart without note records no note", async () => {
    const t = await runs.createTask({ title: "restart-plan-no-note" });
    const wt = await makePlanWorktree(t.id, "draft", "draft");
    await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
    await runs.createRun({ taskId: t.id, phase: "plan" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/plan/restart`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const newJsonl = await readFile(join(wt, ".harness", t.id, "plan.jsonl"), "utf8");
    expect(newJsonl).toContain("session_reset");
    expect(newJsonl).not.toContain("\"note\"");
  });

  it("serializes concurrent plan restart requests for the same task", async () => {
    const observedStore = new ObservedArtifactsStore();
    const testApp = buildServer({
      runs,
      events,
      runsDir: tmpdir(),
      cancellation,
      artifacts: observedStore,
    });
    await testApp.ready();
    try {
      const t = await runs.createTask({ title: "concurrent-restart" });
      const wt = await makePlanWorktree(t.id, "draft", "draft");
      await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
      await runs.createRun({ taskId: t.id, phase: "plan" });

      const [first, second] = await Promise.all([
        testApp.inject({ method: "POST", url: `/api/tasks/${t.id}/plan/restart`, payload: {} }),
        testApp.inject({ method: "POST", url: `/api/tasks/${t.id}/plan/restart`, payload: {} }),
      ]);

      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 200]);
      expect(observedStore.maxConcurrentMutations).toBe(1);
      expect(existsSync(join(wt, ".git", "index.lock"))).toBe(false);
    } finally {
      await testApp.close();
    }
  });

  it("serializes a plan restart racing with a plan artifact edit", async () => {
    const observedStore = new ObservedArtifactsStore();
    const testApp = buildServer({
      runs,
      events,
      runsDir: tmpdir(),
      cancellation,
      artifacts: observedStore,
    });
    await testApp.ready();
    try {
      const t = await runs.createTask({ title: "restart-edit-race" });
      const wt = await makePlanWorktree(t.id, "draft", "draft");
      await runs.updateTask(t.id, { status: "planning", worktreePath: wt, branchName: `pi/${t.id}` });
      await runs.createRun({ taskId: t.id, phase: "plan" });

      const [restart, edit] = await Promise.all([
        testApp.inject({ method: "POST", url: `/api/tasks/${t.id}/plan/restart`, payload: {} }),
        testApp.inject({
          method: "POST",
          url: `/api/tasks/${t.id}/plan/artifact`,
          payload: { kind: "plan", body: "# edited during restart\n" },
        }),
      ]);

      expect([restart.statusCode, edit.statusCode].sort()).toEqual([200, 200]);
      expect(observedStore.maxConcurrentMutations).toBe(1);
      expect(existsSync(join(wt, ".git", "index.lock"))).toBe(false);
    } finally {
      await testApp.close();
    }
  });
});
