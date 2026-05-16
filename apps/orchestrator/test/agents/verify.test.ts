import { describe, it, expect, vi } from "vitest";
import { runVerify } from "../../src/agents/verify.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runVerify", () => {
  it("runs every scenario and writes a proof report", async () => {
    const readPlan = vi.fn(async () => ({
      goal: "x",
      patternsToFollow: [],
      touchpoints: [],
      blastRadius: [],
      precedentWarnings: [],
      steps: [],
      verificationScenarios: {
        scenarios: [
          {
            id: "a",
            type: "api" as const,
            name: "a",
            request: { method: "GET", url: "http://x/y" },
            expect: { status: 200 },
          },
          {
            id: "b",
            type: "api" as const,
            name: "b",
            request: { method: "GET", url: "http://x/y" },
            expect: { status: 200 },
          },
        ],
      },
      outOfScope: [],
      suggestedWorkflow: "backend-feature" as const,
    }));
    const writeProofReport = vi.fn(async () => {});
    const store = { readPlan, writeProofReport, proofDir: () => "/tmp/proof" } as ArtifactsStore;

    const runApiScenario = vi.fn(async (o: { scenario: { id: string } }) => ({
      id: o.scenario.id,
      type: "api" as const,
      ok: true,
      evidence: { status: 200 },
    }));

    const result = await runVerify({
      taskId: "t-1",
      runId: "r-1",
      store,
      runApiScenario,
      runUiScenario: async () => ({ id: "x", type: "ui", ok: false, evidence: {} }),
      runUiVisualScenario: async () => ({ id: "x", type: "ui-visual", ok: false, evidence: {} }),
    });

    expect(runApiScenario).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(writeProofReport).toHaveBeenCalledOnce();
    const writtenReport = writeProofReport.mock.calls[0]![1] as { ok: boolean; scenarios: { id: string }[] };
    expect(writtenReport.scenarios).toHaveLength(2);
  });

  it("returns ok:false when any scenario fails", async () => {
    const readPlan = vi.fn(async () => ({
      goal: "x",
      patternsToFollow: [],
      touchpoints: [],
      blastRadius: [],
      precedentWarnings: [],
      steps: [],
      verificationScenarios: {
        scenarios: [
          {
            id: "a",
            type: "api" as const,
            name: "a",
            request: { method: "GET", url: "http://x" },
            expect: { status: 200 },
          },
        ],
      },
      outOfScope: [],
      suggestedWorkflow: "backend-feature" as const,
    }));
    const writeProofReport = vi.fn(async () => {});
    const store = { readPlan, writeProofReport, proofDir: () => "/tmp" } as ArtifactsStore;

    const result = await runVerify({
      taskId: "t-1",
      runId: "r-1",
      store,
      runApiScenario: async () => ({ id: "a", type: "api", ok: false, error: "x", evidence: {} }),
      runUiScenario: async () => ({ id: "x", type: "ui", ok: false, evidence: {} }),
      runUiVisualScenario: async () => ({ id: "x", type: "ui-visual", ok: false, evidence: {} }),
    });

    expect(result.ok).toBe(false);
    expect(result.firstFailure?.id).toBe("a");
  });
});
