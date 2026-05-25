import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { tmpdir } from "node:os";
import { buildServer } from "../src/http/server.js";
import { mkEvent } from "../src/domain/events.js";
import { createTestStores } from "./helpers/stores.js";

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  expected: string,
  timeoutMs = 2000,
): Promise<string> {
  let buf = "";
  const start = Date.now();
  while (!buf.includes(expected) && Date.now() - start < timeoutMs) {
    const next = await reader.read();
    if (next.value) buf += decoder.decode(next.value);
    if (next.done) break;
  }
  return buf;
}

describe("SSE /api/live/stream", () => {
  const { liveEvents, runs, events } = createTestStores();
  const app = buildServer({ runs, events, liveEvents, runsDir: tmpdir() });
  let port = 0;
  let canListen = true;

  beforeAll(async () => {
    try {
      await app.listen({ port: 0, host: "127.0.0.1" });
      port = (app.server.address() as { port: number }).port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      canListen = false;
    }
  });

  afterAll(async () => {
    if (canListen) await app.close();
  });

  it("streams existing + new run events, ends on close", async () => {
    if (!canListen) return;
    const t = await runs.createTask({ title: "sse" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/live/stream?runId=${r.id}`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = await readUntil(reader, decoder, "event: agent.event.appended");
    expect(buf).toContain("event: agent.event.appended");
    expect(buf).toContain('"kind":"phase_started"');
    expect(buf).toContain("id: ");

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "hi" }));

    buf += await readUntil(reader, decoder, '"text":"hi"');
    expect(buf).toContain('"text":"hi"');

    await reader.cancel();
  });

  it("honors Last-Event-ID replay cursor as a live sequence", async () => {
    if (!canListen) return;
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
    const text = await readUntil(reader, decoder, '"text":"after"');

    expect(text).not.toContain('"phase_started"');
    expect(text).toContain('"text":"after"');

    await reader.cancel();
  });

  it("honors the after query replay cursor as a live sequence", async () => {
    if (!canListen) return;
    const t = await runs.createTask({ title: "sse-after" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "after-query" }));
    const stored = await liveEvents.listAfter({ runId: r.id }, 0);
    const firstSequence = stored.find((event) => event.kind === "agent.event.appended")!.sequence;

    const res = await fetch(
      `http://127.0.0.1:${port}/api/live/stream?runId=${r.id}&after=${firstSequence}`,
    );

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const text = await readUntil(reader, decoder, '"text":"after-query"');

    expect(text).not.toContain('"phase_started"');
    expect(text).toContain('"text":"after-query"');

    await reader.cancel();
  });

  it("returns the latest live sequence cursor", async () => {
    if (!canListen) return;
    const before = await fetch(`http://127.0.0.1:${port}/api/live/cursor`).then((res) => res.json() as Promise<{ sequence: number }>);
    const t = await runs.createTask({ title: "cursor" });
    const after = await fetch(`http://127.0.0.1:${port}/api/live/cursor`).then((res) => res.json() as Promise<{ sequence: number }>);

    expect(after.sequence).toBeGreaterThan(before.sequence);
    expect(t.id).toBeTruthy();
  });

  it("flushes a connected comment before waiting for future tail events", async () => {
    if (!canListen) return;
    const t = await runs.createTask({ title: "sse-tail" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    const cursor = await liveEvents.latestSequence();

    const res = await fetch(
      `http://127.0.0.1:${port}/api/live/stream?runId=${r.id}&after=${cursor}`,
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = decoder.decode((await reader.read()).value);

    expect(buf).toContain(": connected");

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "tail" }));
    buf += await readUntil(reader, decoder, '"text":"tail"');
    expect(buf).toContain('"text":"tail"');

    await reader.cancel();
  });

  it("streams dashboard snapshot and task updates", async () => {
    if (!canListen) return;
    const task = await runs.createTask({ title: "dashboard" });
    const res = await fetch(`http://127.0.0.1:${port}/api/live/stream?scope=dashboard`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = await readUntil(reader, decoder, "event: dashboard.snapshot");
    expect(buf).toContain("event: dashboard.snapshot");
    expect(buf).toContain(task.id);

    await runs.updateTask(task.id, { status: "brainstorming" });

    buf += await readUntil(reader, decoder, "event: task.updated");
    expect(buf).toContain("event: task.updated");
    expect(buf).toContain('"status":"brainstorming"');

    await reader.cancel();
  });

  it("replays task-scoped mission and claim updates", async () => {
    if (!canListen) return;
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
    const text = await readUntil(reader, decoder, "event: claims.updated");

    expect(text).toContain("event: claims.updated");
    expect(text).toContain('"claimEvents"');
    expect(text).toContain('"sourceKey":"scenario:s1"');

    await reader.cancel();
  });
});
