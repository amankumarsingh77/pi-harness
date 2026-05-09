import { describe, it, expect, vi } from "vitest";
import { fanoutResearch, REQUIRED_RESEARCHERS } from "../../src/agents/plan-fanout.js";

describe("fanoutResearch", () => {
  it("dispatches every required researcher in parallel", async () => {
    const calls: string[] = [];
    const runSubagent = vi.fn(async (spec: { agent: string }) => {
      calls.push(spec.agent);
      return { ok: true, output: `out-${spec.agent}`, inputTokens: 1, outputTokens: 1, costUsd: 0 };
    });

    const result = await fanoutResearch({
      cwd: "/tmp",
      task: "Webhook retry",
      runSubagent,
    });

    expect(calls.sort()).toEqual(REQUIRED_RESEARCHERS.slice().sort());
    expect(Object.keys(result.findings).sort()).toEqual(REQUIRED_RESEARCHERS.slice().sort());
    expect(result.totalCostUsd).toBe(0);
  });

  it("aggregates costs and tokens", async () => {
    let i = 0;
    const runSubagent = vi.fn(async () => ({
      ok: true,
      output: `o-${i++}`,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
    }));

    const result = await fanoutResearch({ cwd: "/tmp", task: "x", runSubagent });
    expect(result.totalCostUsd).toBe(0.001 * REQUIRED_RESEARCHERS.length);
    expect(result.totalInputTokens).toBe(10 * REQUIRED_RESEARCHERS.length);
  });

  it("captures failures without aborting siblings", async () => {
    const runSubagent = vi.fn(async (spec: { agent: string }) => ({
      ok: spec.agent !== "codebase-analyzer",
      output: "",
      error: spec.agent === "codebase-analyzer" ? "boom" : undefined,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    }));

    const result = await fanoutResearch({ cwd: "/tmp", task: "x", runSubagent });
    expect(result.findings["codebase-analyzer"]?.ok).toBe(false);
    expect(result.findings["codebase-locator"]?.ok).toBe(true);
  });
});
