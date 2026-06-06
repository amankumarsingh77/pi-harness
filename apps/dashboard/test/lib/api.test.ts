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

  it("fetches Graphify status", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        enabled: true,
        bootstrap: true,
        installed: true,
        version: "0.8.32",
        minVersion: "0.8.32",
        graphExists: true,
        reportExists: true,
        htmlExists: true,
        callflowExists: false,
        treeExists: false,
        jsonBytes: 42,
        job: {
          status: "idle",
          action: null,
          startedAt: null,
          completedAt: null,
          error: null,
        },
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const status = await a.getGraphifyStatus();

    expect(status.graphExists).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/graphify/status", expect.any(Object));
  });

  it("runs Graphify actions with POST", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        enabled: true,
        bootstrap: true,
        installed: true,
        version: "0.8.32",
        minVersion: "0.8.32",
        graphExists: true,
        reportExists: true,
        htmlExists: true,
        callflowExists: false,
        treeExists: false,
        jsonBytes: 42,
        job: {
          status: "running",
          action: "update",
          startedAt: "2026-06-06T00:00:00.000Z",
          completedAt: null,
          error: null,
        },
      }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    await a.runGraphifyAction("update");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/graphify/actions/update",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
