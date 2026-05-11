import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, tasks, runs, events } from "../src/index.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";

describe("schema round-trip", () => {
  const { db, client } = createDb(url);

  afterAll(async () => {
    await client.end();
  });

  it("inserts and reads a task", async () => {
    const [t] = await db
      .insert(tasks)
      .values({ title: "test", description: "desc" })
      .returning();
    expect(t).toBeDefined();
    expect(t!.status).toBe("backlog");

    const [fetched] = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(fetched!.title).toBe("test");

    await db.delete(tasks).where(eq(tasks.id, t!.id));
  });

  it("round-trips phase_models with empty default", async () => {
    const [t] = await db.insert(tasks).values({ title: "pm-empty" }).returning();
    expect(t!.phaseModels).toEqual({});
    await db.delete(tasks).where(eq(tasks.id, t!.id));
  });

  it("round-trips phase_models with a partial brainstorm override", async () => {
    const overrides = { brainstorm: { thinkingLevel: "high", maxTurns: 50 } };
    const [t] = await db
      .insert(tasks)
      .values({ title: "pm-override", phaseModels: overrides })
      .returning();
    const [fetched] = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(fetched!.phaseModels).toEqual(overrides);
    await db.delete(tasks).where(eq(tasks.id, t!.id));
  });

  it("cascades runs and events when task is deleted", async () => {
    const [t] = await db.insert(tasks).values({ title: "cascade" }).returning();
    const [r] = await db.insert(runs).values({ taskId: t!.id, phase: "brainstorm" }).returning();
    await db.insert(events).values({
      taskId: t!.id,
      runId: r!.id,
      kind: "log",
      payload: { level: "info", text: "hello" },
    });

    await db.delete(tasks).where(eq(tasks.id, t!.id));

    const remainingRuns = await db.select().from(runs).where(eq(runs.taskId, t!.id));
    expect(remainingRuns).toHaveLength(0);
    const remainingEvents = await db.select().from(events).where(eq(events.taskId, t!.id));
    expect(remainingEvents).toHaveLength(0);
  });
});
