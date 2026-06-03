import { describe, it, expect } from "vitest";
import {
  BrainstormArtifactSchema,
  PlanArtifactSchema,
  ProofReportSchema,
} from "../src/schemas/artifacts.js";

describe("artifact schemas", () => {
  it("BrainstormArtifact requires goal + decisions[]", () => {
    expect(
      BrainstormArtifactSchema.parse({
        goal: "Retry webhooks bounded.",
        decisions: ["expo backoff", "5 max"],
        openQuestions: [],
        suggestedWorkflow: "backend-feature",
        transcript: [],
      }),
    ).toBeDefined();
  });

  it("PlanArtifact requires steps + verificationScenarios", () => {
    expect(
      PlanArtifactSchema.parse({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [{ id: "s1", title: "t", files: [], assertion: "a" }],
        verificationScenarios: {
          scenarios: [
            {
              id: "v1",
              type: "api",
              name: "n",
              description: "GET /health returns 200 and the body reports the service is up.",
            },
          ],
        },
        outOfScope: [],
        suggestedWorkflow: "backend-feature",
      }),
    ).toBeDefined();
  });

  it("ProofReport requires per-scenario results + overall ok", () => {
    expect(
      ProofReportSchema.parse({
        runId: "r1",
        ok: true,
        scenarios: [
          { id: "s1", type: "api", ok: true, evidence: { responseFile: "x.json", status: 200 } },
        ],
      }),
    ).toBeDefined();
  });

  it("rejects ProofReport missing scenarios", () => {
    expect(() => ProofReportSchema.parse({ runId: "r", ok: true })).toThrow();
  });
});
