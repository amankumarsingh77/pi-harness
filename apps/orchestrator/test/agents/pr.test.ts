import { describe, it, expect, vi } from "vitest";
import { runPr } from "../../src/agents/pr.js";
import type { ArtifactsStore } from "../../src/agents/artifacts-store.js";

describe("runPr", () => {
  it("opens a PR with conventional title + templated body", async () => {
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "push") return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") {
        return { ok: true, stdout: "https://github.com/x/y/pull/42\n" };
      }
      return { ok: false, stdout: "", stderr: "unexpected" };
    });

    const store = {
      readPlan: vi.fn(async () => ({
        goal: "Retry webhooks bounded.",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature" as const,
      })),
      readProofReport: vi.fn(async () => ({
        runId: "r1",
        ok: true,
        scenarios: [{ id: "ok", type: "api" as const, ok: true, evidence: {} }],
      })),
    } as ArtifactsStore;

    const result = await runPr({
      taskId: "t-1",
      branch: "feat/retry",
      cwd: "/tmp/wt",
      store,
      exec,
    });

    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://github.com/x/y/pull/42");

    const ghCall = exec.mock.calls.find((c) => c[0] === "gh");
    expect(ghCall?.[1].slice(0, 2)).toEqual(["pr", "create"]);
    const titleIdx = ghCall![1].indexOf("--title");
    expect(ghCall![1][titleIdx + 1]).toMatch(/^feat: /);
  });

  it("returns ok:false when gh push fails", async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === "git") return { ok: false, stdout: "", stderr: "no remote" };
      return { ok: true, stdout: "" };
    });

    const store = {
      readPlan: vi.fn(async () => ({
        goal: "x",
        patternsToFollow: [],
        touchpoints: [],
        blastRadius: [],
        precedentWarnings: [],
        steps: [],
        verificationScenarios: { scenarios: [] },
        outOfScope: [],
        suggestedWorkflow: "backend-feature" as const,
      })),
      readProofReport: vi.fn(async () => ({
        runId: "r1", ok: true, scenarios: [],
      })),
    } as ArtifactsStore;

    const result = await runPr({
      taskId: "t",
      branch: "b",
      cwd: "/tmp",
      store,
      exec,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no remote");
  });
});
