import { describe, expect, it, vi } from "vitest";
import { PlanEventBus } from "../../src/agents/plan-event-bus.js";

describe("PlanEventBus", () => {
  it("delegates plan events to the centralized phase event log", async () => {
    const phaseEvents = {
      publish: vi.fn(async () => null),
    };
    const bus = new PlanEventBus({
      phaseEvents,
      worktreePath: "/worktree",
      runId: "r1",
      taskId: "T-1",
    });

    await bus.publish({
      kind: "plan_system",
      systemKind: "preflight_started",
    });

    expect(phaseEvents.publish).toHaveBeenCalledWith({
      phase: "plan",
      worktreePath: "/worktree",
      taskId: "T-1",
      runId: "r1",
      input: {
        kind: "plan_system",
        systemKind: "preflight_started",
      },
    });
  });
});
