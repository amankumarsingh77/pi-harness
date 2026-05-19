import "dotenv/config";
import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { LiveEventStore } from "../src/adapters/live-event-store.js";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { mkEvent } from "../src/domain/events.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";

describe("SSE /api/live/stream", () => {
  const { db, client } = createDb(url);
  const liveEvents = new LiveEventStore(db);
  const runs = new RunStore(db, {
    onTaskChanged: (task) => liveEvents.publishTask(task),
    onRunChanged: (run) => liveEvents.publishRun(run),
  });
  const events = new EventStore(db, liveEvents);
  const app = buildServer({ runs, events, liveEvents, runsDir: tmpdir() });
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
    await db.execute("delete from live_events");
    await db.execute("delete from tasks");
  });

  it("streams existing + new run events, ends on close", async () => {
    const t = await runs.createTask({ title: "sse" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/live/stream?runId=${r.id}`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain("event: agent.event.appended");
    expect(buf).toContain('"kind":"phase_started"');
    expect(buf).toContain("id: ");

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "hi" }));

    const start = Date.now();
    while (!buf.includes('"text":"hi"') && Date.now() - start < 2000) {
      const next = await reader.read();
      if (next.value) buf += decoder.decode(next.value);
      if (next.done) break;
    }
    expect(buf).toContain('"text":"hi"');

    await reader.cancel();
  });

  it("honors Last-Event-ID replay cursor as a live sequence", async () => {
    const t = await runs.createTask({ title: "sse-cursor" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "after" }));
    const stored = await liveEvents.listAfter({ runId: r.id }, 0);
    const firstSequence = stored.find((event) => event.kind === "agent.event.appended")!.sequence;

    const res = await fetch(`http://127.0.0.1:${port}/api/live/stream?runId=${r.id}`, {
      headers: { "last-event-id": String(firstSequence) },
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);

    expect(text).not.toContain('"phase_started"');
    expect(text).toContain('"text":"after"');

    await reader.cancel();
  });

  it("streams dashboard snapshot and task updates", async () => {
    const task = await runs.createTask({ title: "dashboard" });
    const res = await fetch(`http://127.0.0.1:${port}/api/live/stream?scope=dashboard`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain("event: dashboard.snapshot");
    expect(buf).toContain(task.id);

    await runs.updateTask(task.id, { status: "brainstorming" });

    const start = Date.now();
    while (!buf.includes("event: task.updated") && Date.now() - start < 2000) {
      const next = await reader.read();
      if (next.value) buf += decoder.decode(next.value);
      if (next.done) break;
    }
    expect(buf).toContain("event: task.updated");
    expect(buf).toContain('"status":"brainstorming"');

    await reader.cancel();
  });

  it("replays task-scoped mission and claim updates", async () => {
    const task = await runs.createTask({ title: "mission-sse" });
    const claim = {
      id: "claim-1",
      taskId: task.id,
      sourceKey: "scenario:s1",
      text: "Scenario smoke must pass",
      owner: "planner",
      status: "pending" as const,
      evidence: [],
      source: "plan" as const,
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    };
    await liveEvents.publishClaimsUpdated(task.id, {
      taskId: task.id,
      claims: [claim],
      claimEvents: [
        {
          type: "claim.created",
          claimId: claim.id,
          taskId: task.id,
          sourceKey: claim.sourceKey,
          text: claim.text,
          owner: claim.owner,
          source: "plan",
          createdAt: claim.createdAt,
        },
      ],
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/live/stream?taskId=${task.id}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);

    expect(text).toContain("event: claims.updated");
    expect(text).toContain('"claimEvents"');
    expect(text).toContain('"sourceKey":"scenario:s1"');

    await reader.cancel();
  });
});
