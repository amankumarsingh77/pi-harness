import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the run-loop module so we control whether and when ticks "run".
vi.mock("../src/runner/run-loop.js", () => ({
  runLoop: vi.fn(),
}));

import { runLoop } from "../src/runner/run-loop.js";
import { TaskScheduler, type SchedulerDeps } from "../src/runner/scheduler.js";

const TASK = (id: string) =>
  ({
    id,
    title: "t",
    description: "",
    status: "brainstorming",
    workflow: "backend-feature",
    worktreePath: null,
    branchName: null,
    retryCount: 0,
    awaitingApproval: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as const;

function buildDeps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  const runs = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTask: vi.fn(async (id: string) => TASK(id) as any),
  };
  const events = {
    append: vi.fn(async () => {}),
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runs: runs as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: events as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    phaseDeps: {} as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    worktrees: {} as any,
    retryCap: 2,
    ...overrides,
  };
}

describe("TaskScheduler", () => {
  beforeEach(() => {
    vi.mocked(runLoop).mockReset();
  });

  it("runs a tick when enqueue is called", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(runLoop).mockResolvedValue({} as any);
    const scheduler = new TaskScheduler(buildDeps());

    scheduler.enqueue("t1");
    await scheduler.drain();

    expect(runLoop).toHaveBeenCalledTimes(1);
    expect(scheduler.inFlightCount()).toBe(0);
  });

  it("serializes ticks per task — concurrent enqueues coalesce into one extra tick", async () => {
    // Make runLoop hang until we release it; while it's hanging we'll fire
    // multiple enqueues. Only one extra tick should run after the first.
    let release: () => void = () => {};
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    vi.mocked(runLoop).mockImplementation(async () => {
      await blocker;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {} as any;
    });

    const scheduler = new TaskScheduler(buildDeps());
    scheduler.enqueue("t1"); // first tick — starts immediately, blocks
    scheduler.enqueue("t1"); // queues a re-tick
    scheduler.enqueue("t1"); // coalesced — no third tick
    scheduler.enqueue("t1"); // coalesced — no fourth tick

    expect(scheduler.inFlightCount()).toBe(1);

    release();
    await scheduler.drain();

    // First tick + exactly one re-tick from the queued flag = 2.
    expect(runLoop).toHaveBeenCalledTimes(2);
  });

  it("two different tasks tick concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    vi.mocked(runLoop).mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {} as any;
    });

    const scheduler = new TaskScheduler(buildDeps());
    scheduler.enqueue("t1");
    scheduler.enqueue("t2");
    await scheduler.drain();

    expect(runLoop).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);
  });

  it("a tick that throws is logged but doesn't poison the scheduler", async () => {
    vi.mocked(runLoop).mockRejectedValueOnce(new Error("boom"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(runLoop).mockResolvedValueOnce({} as any);

    const events = { append: vi.fn(async () => {}) };
    const scheduler = new TaskScheduler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildDeps({ events: events as any }),
    );

    scheduler.enqueue("t1");
    await scheduler.drain();

    // Error was captured + logged.
    expect(events.append).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "log", level: "error" }),
    );

    // Scheduler still works for the next enqueue.
    scheduler.enqueue("t2");
    await scheduler.drain();
    expect(runLoop).toHaveBeenCalledTimes(2);
  });

  it("getTask failure skips the tick without crashing", async () => {
    const runs = {
      getTask: vi.fn(async () => {
        throw new Error("vanished");
      }),
    };
    const scheduler = new TaskScheduler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildDeps({ runs: runs as any }),
    );

    scheduler.enqueue("ghost");
    await scheduler.drain();

    expect(runLoop).not.toHaveBeenCalled();
    expect(scheduler.inFlightCount()).toBe(0);
  });

  it("drain waits for re-tick chains to settle", async () => {
    let calls = 0;
    vi.mocked(runLoop).mockImplementation(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 1));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {} as any;
    });

    const scheduler = new TaskScheduler(buildDeps());
    scheduler.enqueue("t1"); // first tick
    // While the first tick is mid-await, trigger a re-tick via the queued flag.
    setTimeout(() => scheduler.enqueue("t1"), 0);

    await scheduler.drain();

    expect(calls).toBe(2);
    expect(scheduler.inFlightCount()).toBe(0);
  });
});
