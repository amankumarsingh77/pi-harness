import { describe, it, expect, vi } from "vitest";
import { runCode } from "../../src/agents/code.js";

describe("runCode", () => {
  it("returns ok:false when readPlan throws ENOENT (no plan to execute)", async () => {
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const result = await runCode({
      taskId: "t-1",
      cwd: "/tmp/wt",
      onEvent: () => {},
      createSession: async () => {
        throw new Error("createSession should not be called when plan is missing");
      },
      readPlan: async () => {
        throw enoent;
      },
      retryHint: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plan/i);
    expect(result.error).toMatch(/missing|not.*run/i);
  });

  it("parses coder JSON and returns branch/commits", async () => {
    const finalText = `<coder-complete>\n\`\`\`json\n${JSON.stringify({
      branch: "feat/x",
      commits: ["abc1234", "def5678"],
      filesChanged: ["src/a.ts", "tests/a.test.ts"],
    })}\n\`\`\``;

    const session = {
      prompt: vi.fn(async () => ({
        finalText,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
      })),
      close: vi.fn(async () => {}),
    };

    const result = await runCode({
      taskId: "t-1",
      cwd: "/tmp/wt",
      onEvent: () => {},
      createSession: async () => session,
      readPlan: async () => ({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [{ id: "s1", title: "t", files: [], assertion: "a" }],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature",
      }),
      retryHint: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.branch).toBe("feat/x");
    expect(result.commits).toEqual(["abc1234", "def5678"]);
  });

  it("returns ok:false when coder emits <coder-blocked>", async () => {
    const session = {
      prompt: vi.fn(async () => ({
        finalText: "<coder-blocked>\nplan step s2 references nonexistent file",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
      })),
      close: vi.fn(async () => {}),
    };

    const result = await runCode({
      taskId: "t-1",
      cwd: "/tmp/wt",
      onEvent: () => {},
      createSession: async () => session,
      readPlan: async () => ({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature",
      }),
      retryHint: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("blocked");
  });
});
