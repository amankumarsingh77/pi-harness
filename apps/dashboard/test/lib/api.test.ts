import { describe, it, expect, vi } from "vitest";
import { api, ApiError } from "@/lib/api";

describe("api", () => {
  it("listTasks returns parsed shape", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        tasks: [],
        counts: { backlog: 0 },
        humanInterventionTaskIds: ["t-review"],
        summary: {
          runningCount: 0,
          reviewCount: 0,
          blockedCount: 0,
          costUsd: 0,
          costCapUsd: 10,
          lastEventAt: "2026-05-15T10:00:00.000Z",
          activeRunIds: [],
        },
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const r = await a.listTasks();
    expect(r.tasks).toEqual([]);
    expect(r.humanInterventionTaskIds).toEqual(["t-review"]);
    expect(r.summary.lastEventAt?.toISOString()).toBe("2026-05-15T10:00:00.000Z");
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/tasks", expect.any(Object));
  });

  it("throws ApiError on non-2xx", async () => {
    const a = api({
      baseUrl: "http://x",
      fetch: async () => Response.json({ error: "not_found", message: "x" }, { status: 404 }),
    });
    await expect(a.getTask("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("getGraphifyStatus hydrates updatedAt", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        status: {
          status: "installing",
          reason: "missing_cli",
          message: "Graphify CLI not found",
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const result = await a.getGraphifyStatus();

    expect(result.status?.updatedAt).toBeInstanceOf(Date);
    expect(result.status?.updatedAt.toISOString()).toBe("2026-05-21T00:00:00.000Z");
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/graphify/status", expect.any(Object));
  });

  it("getGraphifyStatus accepts an empty status", async () => {
    const a = api({
      baseUrl: "http://x",
      fetch: async () => Response.json({ status: null }),
    });

    await expect(a.getGraphifyStatus()).resolves.toEqual({ status: null });
  });

  it("createTask POSTs body", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        id: "1",
        status: "backlog",
        title: "t",
        description: "",
        priority: "urgent",
        tags: ["bugfix"],
      }, { status: 201 }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    await a.createTask({ title: "t", priority: "urgent", tags: ["bugfix"] });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "t", priority: "urgent", tags: ["bugfix"] }),
      }),
    );
  });

  it("getMission returns the mission packet and folded claims", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        mission: {
          taskId: "task-1",
          goal: "Mission goal",
          successCriteria: ["Proof exists"],
          constraints: [],
          riskLevel: "medium",
          workflowIntent: "backend-feature",
          affectedAreas: ["orchestrator"],
          policyProfile: "medium",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
        claims: [
          {
            id: "claim-1",
            taskId: "task-1",
            sourceKey: "scenario:s1",
            text: "Scenario smoke must pass",
            owner: "planner",
            status: "challenged",
            evidence: [{ kind: "scenario", ref: "s1", note: "red path" }],
            source: "plan",
            verifierNote: "Needs proof",
            createdAt: "2026-05-19T00:00:00.000Z",
            updatedAt: "2026-05-19T00:01:00.000Z",
          },
        ],
        events: [],
        claimEvents: [],
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const bundle = await a.getMission("task-1");

    expect(bundle.mission.goal).toBe("Mission goal");
    expect(bundle.claims[0]?.status).toBe("challenged");
    expect(bundle.claims[0]?.evidence[0]?.ref).toBe("s1");
    expect(bundle.claimEvents).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/tasks/task-1/mission", expect.any(Object));
  });

  it("runVerifier POSTs the verifier request", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        ok: true,
        taskId: "task-1",
        runId: "manual-verifier-1",
        mode: "all",
        verified: [],
        skipped: [],
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const result = await a.runVerifier("task-1", { mode: "all", claimIds: ["claim-1"] });

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/tasks/task-1/verifier/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ mode: "all", claimIds: ["claim-1"] }),
      }),
    );
  });
});
