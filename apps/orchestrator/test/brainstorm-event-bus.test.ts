import { describe, it, expect, vi } from "vitest";
import { BrainstormEventBus } from "../src/agents/brainstorm-event-bus.js";

function makeFakes() {
  const eventStoreAppends: unknown[] = [];
  const jsonlAppends: unknown[] = [];
  const eventStore = {
    append: vi.fn(async (e: unknown) => {
      eventStoreAppends.push(e);
    }),
    // BrainstormEventBus only uses .append; the cast keeps the test from
    // having to construct the full EventStore class.
  };
  const jsonl = {
    append: vi.fn(async (e: unknown) => {
      jsonlAppends.push(e);
    }),
    filePath: () => "/dev/null",
  };
  return { eventStore, jsonl, eventStoreAppends, jsonlAppends };
}

describe("BrainstormEventBus", () => {
  it("publishes once to JSONL and once to EventStore per call", async () => {
    const { eventStore, jsonl } = makeFakes();
    const bus = new BrainstormEventBus({
      eventStore: eventStore as never,
      jsonl: jsonl as never,
      runId: "r1",
      taskId: "T-1",
    });

    await bus.publish({
      kind: "brainstorm_question",
      questionId: "q1",
      prompt: "What's the scope?",
      options: [{ id: "o1", label: "narrow", recommended: true, evidence: ["src/foo.ts:10"] }],
      sectionTarget: { artifact: "design", section: "Goals" },
    });

    expect(jsonl.append).toHaveBeenCalledTimes(1);
    expect(eventStore.append).toHaveBeenCalledTimes(1);
  });

  it("writes JSONL before EventStore (durable-first)", async () => {
    const order: string[] = [];
    const eventStore = { append: vi.fn(async () => { order.push("event"); }) };
    const jsonl = {
      append: vi.fn(async () => { order.push("jsonl"); }),
      filePath: () => "/dev/null",
    };

    const bus = new BrainstormEventBus({
      eventStore: eventStore as never,
      jsonl: jsonl as never,
      runId: "r1",
      taskId: "T-1",
    });

    await bus.publish({
      kind: "brainstorm_system",
      systemKind: "probe_complete",
    });

    expect(order).toEqual(["jsonl", "event"]);
  });

  it("does not publish to EventStore when JSONL fails", async () => {
    const eventStore = { append: vi.fn(async () => {}) };
    const jsonl = {
      append: vi.fn(async () => { throw new Error("disk full"); }),
      filePath: () => "/dev/null",
    };

    const bus = new BrainstormEventBus({
      eventStore: eventStore as never,
      jsonl: jsonl as never,
      runId: "r1",
      taskId: "T-1",
    });

    await expect(
      bus.publish({ kind: "brainstorm_system", systemKind: "probe_complete" }),
    ).rejects.toThrow("disk full");

    expect(eventStore.append).not.toHaveBeenCalled();
  });
});
