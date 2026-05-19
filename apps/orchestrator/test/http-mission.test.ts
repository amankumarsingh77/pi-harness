import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { LiveEventStore } from "../src/adapters/live-event-store.js";
import { ClaimLedgerStore, MissionStore } from "../src/adapters/mission-store.js";
import { buildServer } from "../src/http/server.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:54330/piharness";
const CreatedTaskResponseSchema = z.object({ id: z.string().min(1) });

describe("mission routes", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const liveEvents = new LiveEventStore(db);

  beforeEach(async () => {
    await db.execute("delete from live_events");
    await db.execute("delete from tasks");
  });

  afterAll(async () => {
    await client.end();
  });

  it("POST /api/tasks initializes mission files", async () => {
    const stateDir = await tempStateDir();
    const app = buildServer({
      runs,
      events,
      liveEvents,
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger: new ClaimLedgerStore({ stateDir }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "Mission seed", description: "Create the mission" },
    });

    expect(res.statusCode).toBe(201);
    const { id: taskId } = CreatedTaskResponseSchema.parse(res.json());
    const raw = await readFile(join(stateDir, "tasks", taskId, "mission.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      taskId,
      goal: "Mission seed",
      successCriteria: ["Create the mission"],
    });

    await app.close();
  });

  it("GET /api/tasks/:id/mission repairs old tasks with no mission file", async () => {
    const stateDir = await tempStateDir();
    const task = await runs.createTask({ title: "Old task", description: "repair me" });
    const app = buildServer({
      runs,
      events,
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger: new ClaimLedgerStore({ stateDir }),
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${task.id}/mission` });

    expect(res.statusCode).toBe(200);
    expect(res.json().mission).toMatchObject({
      taskId: task.id,
      goal: "Old task",
      successCriteria: ["repair me"],
    });
    expect(res.json().claims).toEqual([]);
    expect(res.json().claimEvents).toEqual([]);
    expect(await liveEvents.listAfter({ taskId: task.id }, 0)).toEqual([]);

    await app.close();
  });

  it("PATCH /api/tasks/:id/mission updates editable mission fields", async () => {
    const stateDir = await tempStateDir();
    const task = await runs.createTask({ title: "Patch me" });
    const app = buildServer({
      runs,
      events,
      liveEvents,
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger: new ClaimLedgerStore({ stateDir }),
    });
    await app.ready();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}/mission`,
      payload: { goal: "Updated goal", riskLevel: "high" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().mission).toMatchObject({
      goal: "Updated goal",
      riskLevel: "high",
    });
    const published = await liveEvents.listAfter({ taskId: task.id }, 0);
    expect(published.map((event) => event.kind)).toContain("mission.updated");

    await app.close();
  });

  it("POST /api/tasks/:id/claims/:claimId/status updates claim state", async () => {
    const stateDir = await tempStateDir();
    const task = await runs.createTask({ title: "Claim task" });
    const claimLedger = new ClaimLedgerStore({ stateDir });
    await claimLedger.syncPlannedClaims(task.id, [
      { sourceKey: "scenario:S-001", text: "Scenario passes", owner: "planner" },
    ]);
    const [claim] = await claimLedger.listClaims(task.id);
    if (!claim) throw new Error("expected claim to be seeded");
    const app = buildServer({
      runs,
      events,
      liveEvents,
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger,
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/claims/${claim.id}/status`,
      payload: {
        status: "proven",
        verifierNote: "Scenario passed",
        evidence: [{ kind: "scenario", ref: "S-001" }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().claims[0]).toMatchObject({
      id: claim.id,
      status: "proven",
      verifierNote: "Scenario passed",
    });
    expect(res.json().claimEvents.at(-1)).toMatchObject({
      type: "claim.status_changed",
      claimId: claim.id,
    });
    const published = await liveEvents.listAfter({ taskId: task.id }, 0);
    const claimsEvent = published.find((event) => event.kind === "claims.updated");
    expect(claimsEvent?.payload).toMatchObject({
      taskId: task.id,
      claimEvents: [{ type: "claim.status_changed", claimId: claim.id }],
    });

    await app.close();
  });
});

async function tempStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-harness-mission-http-"));
}
