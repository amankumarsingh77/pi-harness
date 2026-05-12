import "dotenv/config";
import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { DashboardEventBus } from "../src/adapters/dashboard-event-bus.js";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { mkEvent } from "../src/domain/events.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";

describe("SSE /api/runs/:id/events/stream", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const dashboardEvents = new DashboardEventBus();
  const app = buildServer({ runs, events, runsDir: tmpdir(), dashboardEvents });
  let port = 0;

  beforeAll(async () => {
    await app.listen({ port: 0 });
    port = (app.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
  });

  it("streams existing + new events, ends on close", async () => {
    const t = await runs.createTask({ title: "sse" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${r.id}/events/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // Read replayed event.
    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain('"kind":"phase_started"');
    expect(buf).toContain(`id: `);

    // Append a new event and verify it streams.
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "hi" }));

    // Read until we see the new event (loop with a small budget).
    const start = Date.now();
    while (!buf.includes('"text":"hi"') && Date.now() - start < 2000) {
      const next = await reader.read();
      if (next.value) buf += decoder.decode(next.value);
      if (next.done) break;
    }
    expect(buf).toContain('"text":"hi"');

    await reader.cancel();
  });

  it("honors Last-Event-ID replay cursor", async () => {
    const t = await runs.createTask({ title: "sse-cursor" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    const firstEvent = mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" });
    const secondEvent = mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "after" });
    await events.append(firstEvent);
    await events.append(secondEvent);

    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${r.id}/events/stream`, {
      headers: { "last-event-id": firstEvent.id },
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);

    expect(text).not.toContain(firstEvent.id);
    expect(text).toContain(secondEvent.id);
    expect(text).toContain('"text":"after"');

    await reader.cancel();
  });

  it("streams dashboard snapshot and task updates", async () => {
    const task = await runs.createTask({ title: "dashboard" });
    const res = await fetch(`http://127.0.0.1:${port}/api/dashboard/events/stream`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain('"kind":"tasks_snapshot"');
    expect(buf).toContain(task.id);

    const updated = await runs.updateTask(task.id, { status: "brainstorming" });
    dashboardEvents.publishTask(updated);

    const start = Date.now();
    while (!buf.includes('"kind":"task_updated"') && Date.now() - start < 2000) {
      const next = await reader.read();
      if (next.value) buf += decoder.decode(next.value);
      if (next.done) break;
    }
    expect(buf).toContain('"kind":"task_updated"');
    expect(buf).toContain('"status":"brainstorming"');

    await reader.cancel();
  });
});
