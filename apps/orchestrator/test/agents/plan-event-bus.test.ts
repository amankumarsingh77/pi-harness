import { describe, it, expect, vi } from "vitest";
import { PlanEventBus } from "../../src/agents/plan-event-bus.js";

function makeFakes() {
  const eventStoreAppends: unknown[] = [];
  const jsonlAppends: unknown[] = [];
  const eventStore = {
    append: vi.fn(async (e: unknown) => {
      eventStoreAppends.push(e);
    }),
  };
  const jsonl = {
    append: vi.fn(async (e: unknown) => {
      jsonlAppends.push(e);
    }),
    filePath: () => "/dev/null",
  };
  return { eventStore, jsonl, eventStoreAppends, jsonlAppends };
}

describe("PlanEventBus", () => {
  it("publishes once to JSONL and once to EventStore per call", async () => {
    const { eventStore, jsonl } = makeFakes();
    const bus = new PlanEventBus({
      eventStore: eventStore as never,
      jsonl: jsonl as never,
      runId: "r1",
      taskId: "T-1",
    });
    await bus.publish({
      kind: "plan_system",
      systemKind: "preflight_started",
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
    const bus = new PlanEventBus({
      eventStore: eventStore as never,
      jsonl: jsonl as never,
      runId: "r1",
      taskId: "T-1",
    });
    await bus.publish({
      kind: "plan_subagent_started",
      subagent: "scope-tracer",
      sessionId: "s1",
    });
    expect(order).toEqual(["jsonl", "event"]);
  });

  it("does not publish to EventStore when JSONL fails", async () => {
    const eventStore = { append: vi.fn(async () => {}) };
    const jsonl = {
      append: vi.fn(async () => { throw new Error("disk full"); }),
      filePath: () => "/dev/null",
    };
    const bus = new PlanEventBus({
      eventStore: eventStore as never,
      jsonl: jsonl as never,
      runId: "r1",
      taskId: "T-1",
    });
    await expect(
      bus.publish({ kind: "plan_system", systemKind: "preflight_started" }),
    ).rejects.toThrow("disk full");
    expect(eventStore.append).not.toHaveBeenCalled();
  });
});
