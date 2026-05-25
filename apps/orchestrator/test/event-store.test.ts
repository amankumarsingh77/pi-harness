import { describe, it, expect } from "vitest";
import { EventStore } from "../src/adapters/event-store.js";
import { mkEvent } from "../src/domain/events.js";
import { RunStore } from "../src/adapters/run-store.js";
import { createBareTestStores } from "./helpers/stores.js";

describe("EventStore", () => {
  it("persists and lists events for a run", async () => {
    const { runs, events } = createBareTestStores();
    const t = await runs.createTask({ title: "events" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));
    await events.append(
      mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "ok" }),
    );

    const list = await events.listForRun(r.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.kind).toBe("phase_started");
  });

  it("notifies subscribers on append", async () => {
    const { stateDir } = createBareTestStores();
    const events = new EventStore({ stateDir });
    const runs = new RunStore({ stateDir });
    const t = await runs.createTask({ title: "sub" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });

    const received: string[] = [];
    const unsub = events.subscribe(r.id, (e) => received.push(e.kind));

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));
    await events.append(
      mkEvent({ runId: r.id, taskId: t.id, kind: "tool_call", tool: "Read", input: {} }),
    );

    expect(received).toEqual(["phase_started", "tool_call"]);
    unsub();
  });

  it("subscribers for one run do not see events from another", async () => {
    const { runs, events } = createBareTestStores();
    const t = await runs.createTask({ title: "iso" });
    const r1 = await runs.createRun({ taskId: t.id, phase: "code" });
    const r2 = await runs.createRun({ taskId: t.id, phase: "verify" });

    const r1got: string[] = [];
    events.subscribe(r1.id, (e) => r1got.push(e.kind));

    await events.append(
      mkEvent({ runId: r2.id, taskId: t.id, kind: "log", level: "info", text: "x" }),
    );

    expect(r1got).toEqual([]);
  });

  it("returns the latest event timestamp across runs", async () => {
    const { runs, events } = createBareTestStores();
    const t = await runs.createTask({ title: "latest" });
    const r1 = await runs.createRun({ taskId: t.id, phase: "code" });
    const r2 = await runs.createRun({ taskId: t.id, phase: "verify" });

    await events.append({
      ...mkEvent({ runId: r1.id, taskId: t.id, kind: "log", level: "info", text: "first" }),
      ts: new Date("2026-05-15T09:00:00.000Z"),
    });
    await events.append({
      ...mkEvent({ runId: r2.id, taskId: t.id, kind: "log", level: "info", text: "second" }),
      ts: new Date("2026-05-15T10:00:00.000Z"),
    });

    expect((await events.latestEventAt())?.toISOString()).toBe("2026-05-15T10:00:00.000Z");
  });
});
