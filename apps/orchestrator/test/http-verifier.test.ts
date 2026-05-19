import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task } from "@pi-harness/shared";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { LiveEventStore } from "../src/adapters/live-event-store.js";
import { ClaimLedgerStore, MissionStore } from "../src/adapters/mission-store.js";
import { ArtifactsStore } from "../src/agents/artifacts-store.js";
import { buildServer } from "../src/http/server.js";

describe("verifier routes", () => {
  it("returns 409 when a task has no worktree", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pi-harness-verifier-state-"));
    const task = taskFixture({ title: "No worktree", worktreePath: null });
    const app = buildServer({
      runs: fakeRuns(task),
      events: fakeEvents(),
      liveEvents: fakeLiveEvents(),
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger: new ClaimLedgerStore({ stateDir }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/verifier/run`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "no_worktree" });

    await app.close();
  });

  it("runs verifier sidecar, updates claims, and publishes live events", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-harness-verifier-worktree-"));
    const stateDir = await mkdtemp(join(tmpdir(), "pi-harness-verifier-state-"));
    const artifacts = new ArtifactsStore();
    const claimLedger = new ClaimLedgerStore({ stateDir });
    const task = taskFixture({ title: "Verify route", worktreePath: cwd });
    const published: unknown[] = [];
    const liveEvents = fakeLiveEvents(published);
    await artifacts.writeArtifact(cwd, task.id, {
      fm: {
        task: task.id,
        kind: "scenarios",
        parent: "plan.md",
        status: "ready",
        branch: `pi/${task.id}`,
        last_updated: "2026-05-20T00:00:00.000Z",
        last_updated_by: "test",
      },
      body: [
        "scenarios:",
        "  - id: S-route",
        "    type: api",
        "    name: route scenario",
        "    request:",
        "      method: GET",
        "      url: /healthz",
        "    expect:",
        "      status: 200",
      ].join("\n"),
    });
    await claimLedger.syncPlannedClaims(task.id, [
      { sourceKey: "scenario:S-route", text: "Health scenario passes", owner: "planner" },
    ]);
    const app = buildServer({
      runs: fakeRuns(task),
      events: fakeEvents(),
      liveEvents,
      artifacts,
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger,
      verifierRunners: {
        runApiScenario: async (opts) => ({
          id: opts.scenario.id,
          type: "api",
          ok: true,
          evidence: { status: 200, responseFile: "responses/S-route.json" },
          durationMs: 3,
        }),
        runUiScenario: async () => ({ id: "unused", type: "ui", ok: false, evidence: {} }),
        runUiVisualScenario: async () => ({ id: "unused", type: "ui-visual", ok: false, evidence: {} }),
      },
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/verifier/run`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, verified: [{ sourceKey: "scenario:S-route" }] });
    expect(await claimLedger.listClaims(task.id)).toMatchObject([
      { sourceKey: "scenario:S-route", status: "proven" },
    ]);
    expect(published).toHaveLength(1);

    await app.close();
  });

  it("rejects invalid verifier request bodies", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-harness-verifier-worktree-"));
    const stateDir = await mkdtemp(join(tmpdir(), "pi-harness-verifier-state-"));
    const task = taskFixture({ title: "Bad body", worktreePath: cwd });
    const app = buildServer({
      runs: fakeRuns(task),
      events: fakeEvents(),
      liveEvents: fakeLiveEvents(),
      runsDir: tmpdir(),
      missionStore: new MissionStore({ stateDir }),
      claimLedger: new ClaimLedgerStore({ stateDir }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/verifier/run`,
      payload: { mode: "everything" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "validation" });

    await app.close();
  });
});

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "T-route",
    title: "Verifier route",
    description: "",
    status: "planning",
    workflow: "backend-feature",
    worktreePath: null,
    branchName: "pi/T-route",
    retryCount: 0,
    priority: "medium",
    tags: [],
    phaseModels: {},
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    updatedAt: new Date("2026-05-20T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeRuns(task: Task): RunStore {
  return {
    getTask: vi.fn(async () => task),
  } as unknown as RunStore;
}

function fakeEvents(): EventStore {
  return {} as EventStore;
}

function fakeLiveEvents(published: unknown[] = []): LiveEventStore {
  return {
    publishClaimsUpdated: vi.fn(async (_taskId: string, payload: unknown) => {
      published.push(payload);
    }),
  } as unknown as LiveEventStore;
}
