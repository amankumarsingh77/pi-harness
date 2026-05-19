import { describe, expect, it } from "vitest";
import {
  ClaimEventSchema,
  MissionPacketSchema,
  foldClaimEvents,
} from "./mission.js";

describe("MissionPacketSchema", () => {
  it("accepts the minimal mission packet shape", () => {
    const parsed = MissionPacketSchema.parse({
      taskId: "task-1",
      goal: "Add file-backed mission state",
      successCriteria: ["Mission loads without a database migration"],
      constraints: ["Do not remove existing task DB storage"],
      riskLevel: "medium",
      workflowIntent: "backend-feature",
      affectedAreas: ["orchestrator", "dashboard"],
      policyProfile: "medium",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    });

    expect(parsed.goal).toBe("Add file-backed mission state");
    expect(parsed.successCriteria).toEqual(["Mission loads without a database migration"]);
  });

  it("rejects empty success criteria", () => {
    const parsed = MissionPacketSchema.safeParse({
      taskId: "task-1",
      goal: "Add file-backed mission state",
      successCriteria: [],
      constraints: [],
      riskLevel: "medium",
      workflowIntent: "backend-feature",
      affectedAreas: [],
      policyProfile: "medium",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ClaimEventSchema", () => {
  it("accepts claim creation events", () => {
    const parsed = ClaimEventSchema.parse({
      type: "claim.created",
      claimId: "claim-1",
      taskId: "task-1",
      sourceKey: "execution-dag:C-001",
      text: "The implementation passes typecheck",
      owner: "planner",
      source: "plan",
      createdAt: "2026-05-19T00:00:00.000Z",
    });

    expect(parsed.type).toBe("claim.created");
    expect("status" in parsed).toBe(false);
  });

  it("rejects status updates without a valid status", () => {
    const parsed = ClaimEventSchema.safeParse({
      type: "claim.status_changed",
      claimId: "claim-1",
      taskId: "task-1",
      status: "unknown",
      updatedAt: "2026-05-19T00:00:00.000Z",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("foldClaimEvents", () => {
  it("folds creation, status, evidence, and notes into current claim state", () => {
    const claims = foldClaimEvents([
      {
        type: "claim.created",
        claimId: "claim-1",
        taskId: "task-1",
        sourceKey: "execution-dag:C-001",
        text: "Retry state persists",
        owner: "planner",
        source: "plan",
        createdAt: "2026-05-19T00:00:00.000Z",
      },
      {
        type: "claim.evidence_added",
        claimId: "claim-1",
        taskId: "task-1",
        evidence: [{ kind: "test", ref: "runner.retry.test.ts", note: "covers retry" }],
        updatedAt: "2026-05-19T00:01:00.000Z",
      },
      {
        type: "claim.status_changed",
        claimId: "claim-1",
        taskId: "task-1",
        status: "proven",
        verifierNote: "Regression test passed",
        updatedAt: "2026-05-19T00:02:00.000Z",
      },
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      id: "claim-1",
      status: "proven",
      verifierNote: "Regression test passed",
    });
    expect(claims[0]?.evidence).toEqual([
      { kind: "test", ref: "runner.retry.test.ts", note: "covers retry" },
    ]);
  });

  it("updates an existing claim with the same source key instead of duplicating it", () => {
    const claims = foldClaimEvents([
      {
        type: "claim.created",
        claimId: "claim-1",
        taskId: "task-1",
        sourceKey: "scenario:S-001",
        text: "Original scenario claim",
        owner: "planner",
        source: "plan",
        createdAt: "2026-05-19T00:00:00.000Z",
      },
      {
        type: "claim.created",
        claimId: "claim-2",
        taskId: "task-1",
        sourceKey: "scenario:S-001",
        text: "Updated scenario claim",
        owner: "planner",
        source: "plan",
        createdAt: "2026-05-19T00:01:00.000Z",
      },
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe("claim-1");
    expect(claims[0]?.text).toBe("Updated scenario claim");
  });
});
