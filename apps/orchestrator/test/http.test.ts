import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("http", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const app = buildServer({ runs, events, runsDir: tmpdir() });

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
      payload: { title: "from http", description: "x" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("backlog");
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
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

  it("user_approve_brainstorm: brainstorming + awaitingApproval → planning", async () => {
    const t = await runs.createTask({ title: "ab" });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      awaitingApproval: true,
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_approve_brainstorm" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.task.status).toBe("planning");
    expect(body.task.awaitingApproval).toBe(false);
  });

  it("user_request_brainstorm_changes: requires comment ≥10 chars", async () => {
    const t = await runs.createTask({ title: "rc" });
    await runs.updateTask(t.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      awaitingApproval: true,
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
    expect(body.task.awaitingApproval).toBe(false);
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
    expect(body.awaitingApproval).toBe(false);
  });
});
