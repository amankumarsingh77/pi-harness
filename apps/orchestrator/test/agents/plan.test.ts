import { describe, it, expect, vi } from "vitest";
import { runPlan } from "../../src/agents/plan.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runPlan", () => {
  it("dispatches research, runs the planner LLM, persists the artifact", async () => {
    const fanoutResearch = vi.fn(async () => ({
      findings: { "codebase-locator": { ok: true, output: "files: x.ts", costUsd: 0 } },
      totalCostUsd: 0,
      totalInputTokens: 5,
      totalOutputTokens: 5,
    }));

    const fakePlan = {
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
            request: { method: "GET", url: "http://x" },
            expect: { status: 200 },
          },
        ],
      },
      outOfScope: ["y"],
      suggestedWorkflow: "backend-feature" as const,
    };
    const finalText = `<plan-complete>\n\`\`\`json\n${JSON.stringify(fakePlan)}\n\`\`\``;

    const session = {
      prompt: vi.fn(async () => ({
        finalText,
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.005,
      })),
      close: vi.fn(async () => {}),
    };

    const writePlan = vi.fn(async () => {});
    const readBrainstorm = vi.fn(async () => ({
      goal: "x",
      decisions: [],
      openQuestions: [],
      suggestedWorkflow: "backend-feature",
      transcript: [],
    }));
    const store = { writePlan, readBrainstorm } as unknown as ArtifactsStore;

    const result = await runPlan({
      taskId: "t-1",
      cwd: "/tmp",
      onEvent: () => {},
      createSession: async () => session,
      runSubagent: vi.fn(async () => ({
        ok: true,
        output: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      })),
      fanoutResearch,
      store,
    });

    expect(result.ok).toBe(true);
    expect(fanoutResearch).toHaveBeenCalledOnce();
    expect(writePlan).toHaveBeenCalledWith("t-1", expect.objectContaining({ goal: "x" }));
    expect(result.totalCostUsd).toBeCloseTo(0.005, 5); // research is 0
  });
});
