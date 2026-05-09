import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("RunStore", () => {
  const { db, client } = createDb(url);
  const store = new RunStore(db);

  beforeAll(async () => {
    // Migration is applied by Plan 1 Task 5 step 10. Tests assume tables exist.
  });

  beforeEach(async () => {
    // Clean slate per test.
    await db.execute("delete from tasks");
  });

  afterAll(async () => {
    await client.end();
  });

  it("createTask + getTask round-trip", async () => {
    const t = await store.createTask({ title: "round-trip", description: "" });
    expect(t.id).toBeDefined();
    expect(t.status).toBe("backlog");

    const fetched = await store.getTask(t.id);
    expect(fetched.title).toBe("round-trip");
  });

  it("listTasksByStatus returns only matching", async () => {
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
    const t = await store.createTask({ title: "with-runs" });
    await store.createRun({ taskId: t.id, phase: "brainstorm" });
    await store.createRun({ taskId: t.id, phase: "plan" });

    const runs = await store.listRuns(t.id);
    expect(runs.map((r) => r.phase)).toEqual(["brainstorm", "plan"]);
  });

  it("countByStatus returns the kanban summary", async () => {
    await store.createTask({ title: "a" });
    await store.createTask({ title: "b" });
    const t = await store.createTask({ title: "c" });
    await store.updateTaskStatus(t.id, "executing");

    const counts = await store.countByStatus();
    expect(counts.backlog).toBe(2);
    expect(counts.executing).toBe(1);
  });
});
