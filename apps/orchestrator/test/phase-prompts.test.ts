import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHASE_MODELS } from "@pi-harness/shared";
import type { AgentSessionOptions } from "@pi-harness/pi-bridge";
import { runPlan } from "../src/agents/plan.js";
import type { PhaseDeps } from "../src/runner/phase-prompts.js";
import { runPhase } from "../src/runner/phase-prompts.js";

vi.mock("../src/agents/plan.js", () => ({
  runPlan: vi.fn(async () => ({
    ok: true,
    ready: true,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  })),
}));

describe("runPhase", () => {
  it("passes claim ledger and claim publisher into the real plan driver", async () => {
    const claimLedger = { listClaims: vi.fn() };
    const claimPublisher = { publishClaimsUpdated: vi.fn() };
    const deps: PhaseDeps = {
      cwd: "/tmp/pi-harness-phase-prompts",
      onEvent: () => {},
      createAgentSession: async (_opts: AgentSessionOptions) => {
        throw new Error("not used");
      },
      store: {},
      eventStore: {},
      claimLedger,
      claimPublisher,
      exec: async () => ({ ok: true, stdout: "" }),
    } as PhaseDeps;

    await runPhase("plan", {
      taskId: "T-1",
      runId: "run-1",
      phaseModel: DEFAULT_PHASE_MODELS.plan,
      sessionPath: "/tmp/session.jsonl",
      ticketTitle: "Plan task",
      ticketDescription: "Plan description",
    }, deps);

    expect(runPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        claimLedger,
        claimPublisher,
      }),
    );
  });
});
