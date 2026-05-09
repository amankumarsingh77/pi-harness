import "dotenv/config";
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { mkEvent } from "../src/domain/events.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("SSE /api/runs/:id/events/stream", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const app = buildServer({ runs, events, runsDir: tmpdir() });

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

    await app.listen({ port: 0 });
    const port = (app.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${r.id}/events/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // Read replayed event.
    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain('"kind":"phase_started"');

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
});
