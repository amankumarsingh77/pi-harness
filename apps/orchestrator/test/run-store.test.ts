import { describe, it, expect } from "vitest";
import { RunStore } from "../src/adapters/run-store.js";
import { createBareTestStores } from "./helpers/stores.js";

describe("RunStore", () => {
  it("createTask + getTask round-trip", async () => {
    const { runs: store } = createBareTestStores();
    const t = await store.createTask({
      title: "round-trip",
      description: "",
      priority: "high",
      tags: ["backend", "bugfix"],
    });
    expect(t.id).toBeDefined();
    expect(t.status).toBe("backlog");
    expect(t.priority).toBe("high");
    expect(t.tags).toEqual(["backend", "bugfix"]);

    const fetched = await store.getTask(t.id);
    expect(fetched.title).toBe("round-trip");
    expect(fetched.priority).toBe("high");
    expect(fetched.tags).toEqual(["backend", "bugfix"]);
  });

  it("createTask defaults board metadata", async () => {
    const { runs: store } = createBareTestStores();
    const t = await store.createTask({ title: "default-meta" });
    expect(t.priority).toBe("none");
    expect(t.tags).toEqual([]);
  });

  it("listTasksByStatus returns only matching", async () => {
    const { runs: store } = createBareTestStores();
    const a = await store.createTask({ title: "a" });
    await store.createTask({ title: "b" });
    await store.updateTaskStatus(a.id, "brainstorming");

    const back = await store.listTasksByStatus("backlog");
    const brain = await store.listTasksByStatus("brainstorming");
    expect(back).toHaveLength(1);
    expect(brain).toHaveLength(1);
    expect(brain[0]!.id).toBe(a.id);
  });

  it("createRun + listRuns returns runs in order", async () => {
    const { runs: store } = createBareTestStores();
    const t = await store.createTask({ title: "with-runs" });
    await store.createRun({ taskId: t.id, phase: "brainstorm" });
    await store.createRun({ taskId: t.id, phase: "plan" });

    const runs = await store.listRuns(t.id);
    expect(runs.map((r) => r.phase)).toEqual(["brainstorm", "plan"]);
  });

  it("notifies an observer after task and run writes", async () => {
    const { stateDir } = createBareTestStores();
    const notifications: string[] = [];
    const observed = new RunStore({ stateDir }, {
      onTaskChanged: (task) => notifications.push(`task:${task.status}`),
      onRunChanged: (run) => notifications.push(`run:${run.status}`),
    });

    const task = await observed.createTask({ title: "observed" });
    const run = await observed.createRun({ taskId: task.id, phase: "brainstorm" });
    await observed.updateTask(task.id, { status: "brainstorming" });
    await observed.updateRun(run.id, { status: "running" });

    expect(notifications).toEqual([
      "task:backlog",
      "run:pending",
      "task:brainstorming",
      "run:running",
    ]);
  });

  it("hasAnyRun is false until the first run is created", async () => {
    const { runs: store } = createBareTestStores();
    const t = await store.createTask({ title: "freeze-probe" });
    expect(await store.hasAnyRun(t.id)).toBe(false);
    await store.createRun({ taskId: t.id, phase: "brainstorm" });
    expect(await store.hasAnyRun(t.id)).toBe(true);
  });

  it("countByStatus returns the kanban summary", async () => {
    const { runs: store } = createBareTestStores();
    await store.createTask({ title: "a" });
    await store.createTask({ title: "b" });
    const t = await store.createTask({ title: "c" });
    await store.updateTaskStatus(t.id, "executing");

    const counts = await store.countByStatus();
    expect(counts.backlog).toBe(2);
    expect(counts.executing).toBe(1);
  });

  it("dashboard summary helpers expose active run ids and total cost", async () => {
    const { runs: store } = createBareTestStores();
    const t = await store.createTask({ title: "summary" });
    const active = await store.createRun({ taskId: t.id, phase: "brainstorm" });
    const settled = await store.createRun({ taskId: t.id, phase: "code" });
    await store.updateRun(active.id, { status: "running", costUsd: 0.25 });
    await store.updateRun(settled.id, { status: "succeeded", costUsd: 0.75 });

    expect(await store.listActiveRunIds()).toEqual([active.id]);
    expect(await store.totalCostUsd()).toBe(1);
  });
});
