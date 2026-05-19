import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Task } from "@pi-harness/shared";
import {
  ClaimLedgerStore,
  MissionStore,
  claimIdForSourceKey,
} from "../src/adapters/mission-store.js";

const task: Task = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Persist mission state",
  description: "Build JSON mission and claims",
  status: "backlog",
  workflow: "backend-feature",
  worktreePath: null,
  branchName: null,
  retryCount: 0,
  priority: "none",
  tags: [],
  phaseModels: {},
  createdAt: new Date("2026-05-19T00:00:00.000Z"),
  updatedAt: new Date("2026-05-19T00:00:00.000Z"),
};

describe("MissionStore", () => {
  it("initializes a missing mission from task data", async () => {
    const stateDir = await tempStateDir();
    const store = new MissionStore({
      stateDir,
      now: () => "2026-05-19T00:00:00.000Z",
    });

    const mission = await store.ensureMission(task);

    expect(mission).toMatchObject({
      taskId: task.id,
      goal: task.title,
      successCriteria: [task.description],
      riskLevel: "medium",
      workflowIntent: "backend-feature",
      policyProfile: "medium",
    });
    const events = await store.listEvents(task.id);
    expect(events.map((event) => event.type)).toEqual(["mission.initialized"]);
  });

  it("updates mission snapshots and appends update events", async () => {
    const stateDir = await tempStateDir();
    const store = new MissionStore({
      stateDir,
      now: () => "2026-05-19T00:00:00.000Z",
    });
    await store.ensureMission(task);

    const updated = await store.updateMission(task, {
      goal: "New goal",
      successCriteria: ["New proof"],
      riskLevel: "high",
    });

    expect(updated.goal).toBe("New goal");
    expect(updated.successCriteria).toEqual(["New proof"]);
    expect(updated.riskLevel).toBe("high");
    const raw = await readFile(join(stateDir, "tasks", task.id, "mission.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ goal: "New goal" });
    const events = await store.listEvents(task.id);
    expect(events.map((event) => event.type)).toEqual([
      "mission.initialized",
      "mission.updated",
    ]);
  });

  it("fails loudly on malformed mission snapshots", async () => {
    const stateDir = await tempStateDir();
    const dir = join(stateDir, "tasks", task.id);
    await writeFile(join(dir, "placeholder"), "", { flag: "w" }).catch(async () => {
      await new MissionStore({ stateDir }).ensureMission(task);
    });
    await writeFile(join(stateDir, "tasks", task.id, "mission.json"), "{bad json", "utf8");

    await expect(new MissionStore({ stateDir }).ensureMission(task)).rejects.toThrow();
  });
});

describe("ClaimLedgerStore", () => {
  it("syncs planned claims idempotently by source key", async () => {
    const stateDir = await tempStateDir();
    const store = new ClaimLedgerStore({
      stateDir,
      now: () => "2026-05-19T00:00:00.000Z",
    });

    const firstSync = await store.syncPlannedClaims(task.id, [
      {
        sourceKey: "execution-dag:C-001",
        text: "Runner persists retry state",
        owner: "planner",
      },
    ]);
    const secondSync = await store.syncPlannedClaims(task.id, [
      {
        sourceKey: "execution-dag:C-001",
        text: "Runner persists retry state",
        owner: "planner",
      },
    ]);

    const claims = await store.listClaims(task.id);
    expect(firstSync.events).toHaveLength(1);
    expect(secondSync.events).toHaveLength(0);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe(claimIdForSourceKey(task.id, "execution-dag:C-001"));
  });

  it("folds status updates, evidence, notes, and skips malformed JSONL lines", async () => {
    const stateDir = await tempStateDir();
    const store = new ClaimLedgerStore({
      stateDir,
      now: () => "2026-05-19T00:00:00.000Z",
    });
    await store.syncPlannedClaims(task.id, [
      {
        sourceKey: "scenario:S-001",
        text: "API scenario passes",
        owner: "planner",
      },
    ]);
    const claimId = claimIdForSourceKey(task.id, "scenario:S-001");

    const result = await store.updateClaimStatus(task.id, claimId, {
      status: "challenged",
      verifierNote: "Needs proof",
      evidence: [{ kind: "scenario", ref: "S-001" }],
    });
    await writeFile(
      join(stateDir, "tasks", task.id, "claims.jsonl"),
      "{torn\n",
      { flag: "a" },
    );

    const claims = await store.listClaims(task.id);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("claim.status_changed");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      id: claimId,
      status: "challenged",
      verifierNote: "Needs proof",
    });
    expect(claims[0]?.evidence).toEqual([{ kind: "scenario", ref: "S-001" }]);
  });
});

async function tempStateDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-harness-mission-"));
}
