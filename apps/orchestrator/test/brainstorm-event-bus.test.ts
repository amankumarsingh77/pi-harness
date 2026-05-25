import { describe, expect, it, vi } from "vitest";
import { BrainstormEventBus } from "../src/agents/brainstorm-event-bus.js";
import type { PhaseEventLogStore } from "../src/adapters/phase-event-log-store.js";

describe("BrainstormEventBus", () => {
  it("delegates brainstorm events to the centralized phase event log", async () => {
    const phaseEvents = {
      publish: vi.fn(async () => null),
    };
    const bus = new BrainstormEventBus({
      phaseEvents: phaseEvents as unknown as PhaseEventLogStore,
      worktreePath: "/worktree",
      runId: "r1",
      taskId: "T-1",
    });

    await bus.publish({
      kind: "brainstorm_system",
      systemKind: "probe_complete",
    });

    expect(phaseEvents.publish).toHaveBeenCalledWith({
      phase: "brainstorm",
      worktreePath: "/worktree",
      taskId: "T-1",
      runId: "r1",
      input: {
        kind: "brainstorm_system",
        systemKind: "probe_complete",
      },
    });
  });
});
