import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import simpleGit from "simple-git";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { ArtifactsStore } from "../src/agents/artifacts-store.js";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { CancellationRegistry } from "../src/runner/cancellation.js";

// Build a real git worktree with both artifacts in `status: ready`. Used by
// tests that exercise the brainstorm approval gate — the route enforces the
// gate is open by reading filesystem facts, not a stored boolean.
// Like makeReadyWorktree but leaves both artifacts in `status: draft` so the
// brainstorm gate stays "running". Use this for nudge tests that need an
// open gate.
async function makeDraftWorktree(taskId: string): Promise<string> {
  const wt = await mkdtemp(join(tmpdir(), "pi-harness-bs-draft-"));
  const git = simpleGit(wt);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(wt, "README.md"), "init\n");
  await git.add("README.md");
  await git.commit("init");
  const dir = join(wt, ".harness", taskId);
  await mkdir(dir, { recursive: true });
  const store = new ArtifactsStore();
  for (const kind of ["design", "spec"] as const) {
    await store.writeArtifact(wt, taskId, {
      fm: {
        task: taskId,
        kind,
        parent: kind === "spec" ? "design.md" : null,
        branch: `pi/${taskId}`,
        status: "draft",
        last_updated: new Date().toISOString(),
        last_updated_by: "test",
      },
      body: "# draft\n",
    });
  }
  await git.add(".");
  await git.commit("scaffold");
  return wt;
}

function makePagedMock(taskId: string, mockId = "mock-a") {
  return {
    mockId,
    title: "Split pane",
    summary: "Shows options beside artifacts.",
    recommended: true,
    createdAt: "2026-05-13T00:00:00.000Z",
    pages: [
      {
        pageId: "task-detail",
        title: "Task detail",
        htmlPath: `.harness/${taskId}/mocks/${mockId}/task-detail.html`,
      },
    ],
  };
}

const PAGED_MOCK_HTML = [{ pageId: "task-detail", html: "<h1>Mock A</h1>" }];

async function makeReadyWorktree(taskId: string): Promise<string> {
  const wt = await mkdtemp(join(tmpdir(), "pi-harness-bs-"));
  const git = simpleGit(wt);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(wt, "README.md"), "init\n");
  await git.add("README.md");
  await git.commit("init");
  const dir = join(wt, ".harness", taskId);
  await mkdir(dir, { recursive: true });
  const store = new ArtifactsStore();
  for (const kind of ["design", "spec"] as const) {
    await store.writeArtifact(wt, taskId, {
      fm: {
        task: taskId,
        kind,
        parent: kind === "spec" ? "design.md" : null,
        branch: `pi/${taskId}`,
        status: "ready",
        last_updated: new Date().toISOString(),
        last_updated_by: "test",
      },
      body: "# ready\n",
    });
  }
  await git.add(".");
  await git.commit("ready");
  return wt;
}

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";

describe("http", () => {
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

  it("GET /healthz returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/tasks creates a task in backlog", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        title: "from http",
        description: "x",
        priority: "urgent",
        tags: ["Bug Fix", "bug-fix", "Needs Design", "  "],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("backlog");
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
    expect(body.priority).toBe("urgent");
    expect(body.tags).toEqual(["bug-fix", "needs-design"]);
  });

  it("POST /api/tasks rejects invalid priority", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "bad priority", priority: "highest" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/tasks rejects empty title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/tasks lists with status counts", async () => {
    await runs.createTask({ title: "a" });
    await runs.createTask({ title: "b" });
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.counts.backlog).toBe(2);
  });

  it("POST /api/tasks/:id/transitions runs state-machine + persists", async () => {
    const t = await runs.createTask({ title: "trans" });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_start_brainstorm", workflow: "backend-feature" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.task.status).toBe("brainstorming");
    expect(body.task.workflow).toBe("backend-feature");
  });

  it("POST /api/tasks/:id/transitions rejects invalid transition with 409", async () => {
    const t = await runs.createTask({ title: "x" });
    await runs.updateTask(t.id, { status: "done" });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_cancel" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("user_approve_brainstorm: open gate → planning", async () => {
    const t = await runs.createTask({ title: "ab" });
    const worktree = await makeReadyWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_approve_brainstorm" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.task.status).toBe("planning");
  });

  it("user_approve_brainstorm closes the active brainstorm run + emits phase_ended", async () => {
    const t = await runs.createTask({ title: "approve-closes-run" });
    const worktree = await makeReadyWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    // Simulate a brainstorm run that's been kept open across ticks (the
    // run-loop intentionally doesn't terminate it on mark_ready — the
    // approve route does, here, so the dashboard's SSE keeps a single
    // runId across the awaiting-user pause).
    const activeRun = await runs.createRun({ taskId: t.id, phase: "brainstorm" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_approve_brainstorm" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe("planning");

    const refreshed = await runs.listRuns(t.id);
    const brainstormRun = refreshed.find((r) => r.id === activeRun.id);
    expect(brainstormRun?.status).toBe("succeeded");
    expect(brainstormRun?.endedAt).not.toBeNull();

    const replay = await events.listForRun(activeRun.id);
    const ended = replay.find((e) => e.kind === "phase_ended");
    expect(ended).toBeDefined();
    expect((ended as { status?: string } | undefined)?.status).toBe("succeeded");
  });

  it("user_cancel: settles all active runs and emits phase_ended cancelled", async () => {
    const t = await runs.createTask({ title: "cancel-settles" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });
    const activeRun = await runs.createRun({ taskId: t.id, phase: "brainstorm" });

    const controller = cancellation.register(t.id);
    expect(controller.signal.aborted).toBe(false);

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_cancel" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe("cancelled");

    expect(controller.signal.aborted).toBe(true);

    const refreshed = await runs.getRun(activeRun.id);
    expect(refreshed.status).toBe("cancelled");
    expect(refreshed.endedAt).not.toBeNull();

    const replay = await events.listForRun(activeRun.id);
    const ended = replay.find((e) => e.kind === "phase_ended");
    expect(ended).toBeDefined();
    expect((ended as { status?: string } | undefined)?.status).toBe("cancelled");
  });

  it("user_approve_brainstorm: 409 when gate is closed (artifacts not ready)", async () => {
    const t = await runs.createTask({ title: "ab-closed" });
    const worktree = await mkdtemp(join(tmpdir(), "pi-harness-closed-"));
    await mkdir(join(worktree, ".harness", t.id), { recursive: true });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_approve_brainstorm" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "gate_closed" });
  });

  it("user_request_brainstorm_changes: requires comment ≥10 chars", async () => {
    const t = await runs.createTask({ title: "rc" });
    const worktree = await makeReadyWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const tooShort = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_request_brainstorm_changes", comment: "short" },
    });
    expect(tooShort.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_request_brainstorm_changes", comment: "please add more detail" },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.task.status).toBe("brainstorming");

    // Revision must be persisted to brainstorm.jsonl so the next agent tick
    // (decide() in brainstorm.ts) can build a revision prompt from it.
    const jsonl = await readFile(
      join(worktree, ".harness", t.id, "brainstorm.jsonl"),
      "utf8",
    );
    const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "brainstorm_revision_requested",
      comment: "please add more detail",
    });

    // Frontmatter must be reset to draft on both artifacts. Without this the
    // gate would re-derive as awaiting_user on the next tick and the
    // dashboard's "Ready for approval" card would reappear.
    const store = new ArtifactsStore();
    const design = await store.readArtifact(worktree, t.id, "design");
    const spec = await store.readArtifact(worktree, t.id, "spec");
    expect(design?.fm.status).toBe("draft");
    expect(spec?.fm.status).toBe("draft");
  });

  it("POST /api/tasks/:id/brainstorm/nudge appends a brainstorm_user_nudge to JSONL", async () => {
    const t = await runs.createTask({ title: "nudge-1" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/nudge`,
      payload: { comment: "ignore the auth angle, deprecated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    const body = res.json() as { nudgeId?: string };
    expect(typeof body.nudgeId).toBe("string");
    expect((body.nudgeId ?? "").length).toBeGreaterThan(0);

    const jsonl = await readFile(
      join(worktree, ".harness", t.id, "brainstorm.jsonl"),
      "utf8",
    );
    const events = jsonl
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const nudges = events.filter((e) => e.kind === "brainstorm_user_nudge");
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      kind: "brainstorm_user_nudge",
      comment: "ignore the auth angle, deprecated",
      consumed: false,
    });
    expect(typeof nudges[0]!["nudgeId"]).toBe("string");
  });

  it("POST /api/tasks/:id/brainstorm/nudge rejects empty comment with 400", async () => {
    const t = await runs.createTask({ title: "nudge-empty" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/nudge`,
      payload: { comment: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/tasks/:id/brainstorm/nudge rejects oversize comment with 400", async () => {
    const t = await runs.createTask({ title: "nudge-big" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/nudge`,
      payload: { comment: "x".repeat(4001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/tasks/:id/brainstorm/nudge returns 409 when gate is awaiting_user (artifacts ready)", async () => {
    const t = await runs.createTask({ title: "nudge-gate-closed" });
    // makeReadyWorktree creates artifacts already in `status: ready`, which
    // the gate derivation reads as awaiting_user. The route must refuse the
    // nudge so it doesn't sit unconsumed past the runBrainstorm short-circuit.
    const worktree = await makeReadyWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/nudge`,
      payload: { comment: "too late, gate is closed" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "gate_closed" });
  });

  it("POST /api/tasks/:id/brainstorm/nudge returns 409 when task has no worktree", async () => {
    const t = await runs.createTask({ title: "nudge-no-wt" });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/nudge`,
      payload: { comment: "anything" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "no_worktree" });
  });

  it("GET /api/tasks/:id/brainstorm/diff returns baseline + current bodies", async () => {
    const t = await runs.createTask({ title: "diff-1" });
    // Build a worktree with two commits on the design artifact: scaffold body
    // then "ready" body. With no revisions filed, baseline = scaffold parent
    // = the initial repo state where the file didn't exist.
    const wt = await mkdtemp(join(tmpdir(), "pi-harness-diff-"));
    const git = simpleGit(wt);
    await git.init();
    await git.addConfig("user.email", "test@example.com", false, "local");
    await git.addConfig("user.name", "Test", false, "local");
    await writeFile(join(wt, "README.md"), "init\n");
    await git.add("README.md");
    await git.commit("init");
    const dir = join(wt, ".harness", t.id);
    await mkdir(dir, { recursive: true });
    const store = new ArtifactsStore();
    // Scaffold draft.
    await store.writeArtifact(wt, t.id, {
      fm: {
        task: t.id,
        kind: "design",
        parent: null,
        branch: `pi/${t.id}`,
        status: "draft",
        last_updated: new Date().toISOString(),
        last_updated_by: "test",
      },
      body: "# Design\n\n_Draft_\n",
    });
    await store.writeArtifact(wt, t.id, {
      fm: {
        task: t.id,
        kind: "spec",
        parent: "design.md",
        branch: `pi/${t.id}`,
        status: "draft",
        last_updated: new Date().toISOString(),
        last_updated_by: "test",
      },
      body: "# Spec\n\n_Draft_\n",
    });
    await git.raw(["add", "-f", ".harness"]);
    await git.commit("scaffold");
    // Update design + mark ready (commit message contains 'mark design as ready').
    await store.writeArtifact(wt, t.id, {
      fm: {
        task: t.id,
        kind: "design",
        parent: null,
        branch: `pi/${t.id}`,
        status: "draft",
        last_updated: new Date().toISOString(),
        last_updated_by: "agent",
      },
      body: "# Design\n\n## Goals\nfilled in by the agent\n",
    });
    await store.setArtifactStatus(wt, t.id, "design", "ready", "agent");

    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: wt,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/brainstorm/diff?kind=design`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      kind: string;
      baseline: { commit: string; body: string } | null;
      current: { body: string } | null;
    };
    expect(body.kind).toBe("design");
    // Baseline = parent of "mark ready" commit = the scaffold commit's body
    // (which has the "_Draft_" placeholder).
    expect(body.baseline).not.toBeNull();
    expect(body.baseline!.body).toContain("_Draft_");
    expect(body.current).not.toBeNull();
    expect(body.current!.body).toContain("filled in by the agent");
  });

  it("GET /api/tasks/:id/brainstorm/diff rejects missing/unknown kind with 400", async () => {
    const t = await runs.createTask({ title: "diff-bad-kind" });
    const wt = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: wt,
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/brainstorm/diff?kind=garbage`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/tasks/:id/brainstorm/diff returns 409 when no worktree", async () => {
    const t = await runs.createTask({ title: "diff-no-wt" });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/brainstorm/diff?kind=design`,
    });
    expect(res.statusCode).toBe(409);
  });

  it("POST /api/tasks/:id/brainstorm/restart archives, settles run, seeds nudge, re-scaffolds", async () => {
    const t = await runs.createTask({ title: "restart-1" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    // Active run that should get settled to cancelled.
    const activeRun = await runs.createRun({ taskId: t.id, phase: "brainstorm" });

    // Pre-populate brainstorm.jsonl with a question + an answer so we can
    // verify the restart archives them.
    const oldJsonl = join(worktree, ".harness", t.id, "brainstorm.jsonl");
    await writeFile(
      oldJsonl,
      JSON.stringify({ ts: "t1", kind: "brainstorm_question", questionId: "q1", prompt: "?" }) +
        "\n" +
        JSON.stringify({ ts: "t2", kind: "brainstorm_answer", questionId: "q1", optionId: "a" }) +
        "\n",
    );
    // Pretend the agent persisted a session file too.
    await writeFile(join(worktree, ".harness", t.id, "pi-session.jsonl"), "session\n");
    const preRestartStore = new ArtifactsStore();
    await preRestartStore.writeBrainstormMock(
      worktree,
      t.id,
      makePagedMock(t.id),
      PAGED_MOCK_HTML,
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/restart`,
      payload: { note: "Focus on backend only — ignore the UI angle." },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok?: boolean;
      archivedRunId?: string;
      newRunId?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.archivedRunId).toBe(activeRun.id);
    expect(typeof body.newRunId).toBe("string");
    expect(body.newRunId).not.toBe(activeRun.id);

    // Old artifacts archived.
    const { existsSync } = await import("node:fs");
    const archive = join(worktree, ".harness", t.id, "runs", activeRun.id);
    expect(existsSync(join(archive, "brainstorm.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "design.md"))).toBe(true);
    expect(existsSync(join(archive, "spec.md"))).toBe(true);
    expect(existsSync(join(archive, "pi-session.jsonl"))).toBe(true);
    expect(existsSync(join(archive, "mocks", "mock-a", "task-detail.html"))).toBe(true);
    expect(existsSync(join(archive, "mocks", "manifest.json"))).toBe(true);

    // Fresh artifacts re-scaffolded in draft state.
    const restartStore = new ArtifactsStore();
    const design = await restartStore.readArtifact(worktree, t.id, "design");
    const spec = await restartStore.readArtifact(worktree, t.id, "spec");
    expect(design?.fm.status).toBe("draft");
    expect(spec?.fm.status).toBe("draft");

    // New JSONL contains exactly the seeded nudge + a session_reset system event.
    const newJsonl = (await readFile(oldJsonl, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const nudges = newJsonl.filter((e) => e.kind === "brainstorm_user_nudge");
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({
      kind: "brainstorm_user_nudge",
      comment: "Focus on backend only — ignore the UI angle.",
      consumed: false,
    });
    const sysEvents = newJsonl.filter((e) => e.kind === "brainstorm_system");
    const reset = sysEvents.find((e) => e["systemKind"] === "session_reset");
    expect(reset).toBeDefined();
    expect((reset!["data"] as { archivedRunId?: string }).archivedRunId).toBe(activeRun.id);

    // Active run was settled.
    const settled = await runs.getRun(activeRun.id);
    expect(settled.status).toBe("cancelled");
    expect(settled.endedAt).not.toBeNull();
  });

  it("POST /api/tasks/:id/brainstorm/restart accepts no note (no nudge seeded)", async () => {
    const t = await runs.createTask({ title: "restart-no-note" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    await runs.createRun({ taskId: t.id, phase: "brainstorm" });

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/restart`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const newJsonl = (await readFile(
      join(worktree, ".harness", t.id, "brainstorm.jsonl"),
      "utf8",
    ))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const nudges = newJsonl.filter((e) => e.kind === "brainstorm_user_nudge");
    expect(nudges).toHaveLength(0);
    // session_reset still emitted so the dashboard knows the boundary.
    const reset = newJsonl.find(
      (e) => e.kind === "brainstorm_system" && e["systemKind"] === "session_reset",
    );
    expect(reset).toBeDefined();
  });

  it("POST /api/tasks/:id/brainstorm/restart returns 409 when task is past brainstorming", async () => {
    const t = await runs.createTask({ title: "restart-late" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "planning",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/restart`,
      payload: { note: "too late" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_brainstorming" });
  });

  it("POST /api/tasks/:id/brainstorm/restart returns 409 when no worktree exists", async () => {
    const t = await runs.createTask({ title: "restart-no-wt" });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/restart`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "no_worktree" });
  });

  it("POST /api/tasks/:id/brainstorm/artifact replaces body, flips status, commits, emits event", async () => {
    const t = await runs.createTask({ title: "edit-1" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/artifact`,
      payload: {
        kind: "design",
        body: "# Design\n\n## Goals\nuser-authored text\n",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok?: boolean; commitSha?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.commitSha).toBe("string");

    const editStore = new ArtifactsStore();
    const design = await editStore.readArtifact(worktree, t.id, "design");
    expect(design?.fm.status).toBe("human_edited");
    expect(design?.fm.last_updated_by).toBe("human");
    expect(design?.body).toBe("# Design\n\n## Goals\nuser-authored text\n");

    // Event landed in JSONL.
    const jsonl = (await readFile(
      join(worktree, ".harness", t.id, "brainstorm.jsonl"),
      "utf8",
    ))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const edited = jsonl.find((e) => e.kind === "brainstorm_artifact_edited");
    expect(edited).toBeDefined();
    expect(edited!["artifact"]).toBe("design");
    expect(edited!["commitSha"]).toBe(body.commitSha);
  });

  it("POST /api/tasks/:id/brainstorm/artifact rejects when task is past brainstorming", async () => {
    const t = await runs.createTask({ title: "edit-late" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "planning",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/artifact`,
      payload: { kind: "design", body: "should fail\n" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "not_brainstorming" });
  });

  it("POST /api/tasks/:id/brainstorm/artifact rejects empty body with 400", async () => {
    const t = await runs.createTask({ title: "edit-empty" });
    const worktree = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath: worktree,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/artifact`,
      payload: { kind: "design", body: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/tasks/:id/brainstorm/mocks returns manifest and selected mock", async () => {
    const t = await runs.createTask({ title: "mock task" });
    const wt = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, { status: "brainstorming", worktreePath: wt });
    const store = new ArtifactsStore();
    await store.writeBrainstormMock(wt, t.id, makePagedMock(t.id), PAGED_MOCK_HTML);
    await store.selectBrainstormMock(wt, t.id, "mock-a");

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/brainstorm/mocks` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mocks: [{ mockId: "mock-a", title: "Split pane" }],
      selectedMockId: "mock-a",
    });
  });

  it("GET /api/tasks/:id/brainstorm/mocks/:mockId/pages/:pageId/html returns page HTML", async () => {
    const t = await runs.createTask({ title: "mock task" });
    const wt = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, { status: "brainstorming", worktreePath: wt });
    const store = new ArtifactsStore();
    await store.writeBrainstormMock(wt, t.id, makePagedMock(t.id), PAGED_MOCK_HTML);

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/brainstorm/mocks/mock-a/pages/task-detail/html`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Mock A");
  });

  it("POST /api/tasks/:id/brainstorm/mocks/:mockId/edit appends request and enqueues", async () => {
    const t = await runs.createTask({ title: "mock task" });
    const wt = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, { status: "brainstorming", worktreePath: wt });
    const store = new ArtifactsStore();
    await store.writeBrainstormMock(wt, t.id, makePagedMock(t.id), PAGED_MOCK_HTML);
    const enqueue = vi.fn();
    const testApp = buildServer({
      runs,
      events,
      runsDir: tmpdir(),
      scheduler: { enqueue } as never,
    });
    const res = await testApp.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/mocks/mock-a/edit`,
      payload: { comment: "Make the artifact pane narrower." },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().requestId).toMatch(/^mer_/);
    expect(enqueue).toHaveBeenCalledWith(t.id);
    const jsonl = await readFile(join(wt, ".harness", t.id, "brainstorm.jsonl"), "utf8");
    expect(jsonl).toContain("brainstorm_mock_edit_requested");
  });

  it("POST /api/tasks/:id/brainstorm/mocks/:mockId/select rejects a mock with a submitted edit", async () => {
    const t = await runs.createTask({ title: "mock task" });
    const wt = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, { status: "brainstorming", worktreePath: wt });
    const store = new ArtifactsStore();
    const mock = makePagedMock(t.id);
    await store.writeBrainstormMock(wt, t.id, mock, PAGED_MOCK_HTML);
    await writeFile(
      join(wt, ".harness", t.id, "brainstorm.jsonl"),
      `${JSON.stringify({ ts: "2026-05-13T00:00:00.000Z", kind: "brainstorm_mock_proposed", mock })}\n${JSON.stringify({ ts: "2026-05-13T00:00:01.000Z", kind: "brainstorm_mock_edit_requested", requestId: "mer_1", mockId: "mock-a", comment: "Narrow it." })}\n`,
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/mocks/mock-a/select`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("mock_edit_already_submitted");
  });

  it("POST /api/tasks/:id/brainstorm/mocks/:mockId/select updates manifest and enqueues", async () => {
    const t = await runs.createTask({ title: "mock task" });
    const wt = await makeDraftWorktree(t.id);
    await runs.updateTask(t.id, { status: "brainstorming", worktreePath: wt });
    const store = new ArtifactsStore();
    await store.writeBrainstormMock(wt, t.id, makePagedMock(t.id), PAGED_MOCK_HTML);
    const enqueue = vi.fn();
    const testApp = buildServer({
      runs,
      events,
      runsDir: tmpdir(),
      scheduler: { enqueue } as never,
    });

    const res = await testApp.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/brainstorm/mocks/mock-a/select`,
    });

    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledWith(t.id);
    await expect(store.readBrainstormMockManifest(wt, t.id)).resolves.toMatchObject({
      selectedMockId: "mock-a",
    });
    const jsonl = await readFile(join(wt, ".harness", t.id, "brainstorm.jsonl"), "utf8");
    expect(jsonl).toContain("brainstorm_mock_selected");
  });

  it("user_request_brainstorm_changes: 409 when task has no worktree", async () => {
    const t = await runs.createTask({ title: "rc-no-worktree" });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_request_brainstorm_changes", comment: "please add more detail" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "no_worktree" });
  });

  it("PATCH /api/tasks/:id phaseModels with zero runs persists", async () => {
    const t = await runs.createTask({ title: "pm-zero" });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t.id}`,
      payload: { phaseModels: { brainstorm: { thinkingLevel: "high" } } },
    });
    expect(res.statusCode).toBe(200);
    const fetched = await runs.getTask(t.id);
    expect(fetched.phaseModels).toEqual({ brainstorm: { thinkingLevel: "high" } });
  });

  it("PATCH /api/tasks/:id phaseModels after first run returns 409 phase_models_frozen", async () => {
    const t = await runs.createTask({ title: "pm-frozen" });
    await runs.createRun({ taskId: t.id, phase: "brainstorm" });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t.id}`,
      payload: { phaseModels: { brainstorm: { thinkingLevel: "high" } } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: "phase_models_frozen",
      message: expect.stringContaining("phaseModels"),
    });
    const fetched = await runs.getTask(t.id);
    expect(fetched.phaseModels).toEqual({});
  });

  it("PATCH /api/tasks/:id title is unfrozen even after first run", async () => {
    const t = await runs.createTask({ title: "pm-title" });
    await runs.createRun({ taskId: t.id, phase: "brainstorm" });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t.id}`,
      payload: { title: "renamed after run" },
    });
    expect(res.statusCode).toBe(200);
    const fetched = await runs.getTask(t.id);
    expect(fetched.title).toBe("renamed after run");
  });

  it("PATCH /api/tasks/:id rejects unknown phase keys with 400", async () => {
    const t = await runs.createTask({ title: "pm-unknown" });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t.id}`,
      payload: { phaseModels: { deploy: { thinkingLevel: "high" } } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/tasks/:id partial override persists exactly as sent", async () => {
    const t = await runs.createTask({ title: "pm-partial" });
    const payload = { phaseModels: { brainstorm: { thinkingLevel: "high" as const } } };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${t.id}`,
      payload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.phaseModels).toEqual(payload.phaseModels);
  });

  it("GET /api/tasks/:id/brainstorm returns empty bundle pre-worktree", async () => {
    const t = await runs.createTask({ title: "bs" });
    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/brainstorm`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.design).toBeNull();
    expect(body.spec).toBeNull();
    expect(body.events).toEqual([]);
    expect(body.gate).toBe("running");
  });
});
