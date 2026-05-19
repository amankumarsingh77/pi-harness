import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHASE_MODELS } from "@pi-harness/shared";
import type { AgentSessionOptions } from "@pi-harness/pi-bridge";
import { runPlan } from "../src/agents/plan.js";
import { runVerifierSidecar } from "../src/agents/verifier-sidecar.js";
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

vi.mock("../src/agents/verifier-sidecar.js", () => ({
  runVerifierSidecar: vi.fn(async () => ({
    ok: true,
    taskId: "T-1",
    runId: "run-1",
    mode: "pending",
    verified: [{ claimId: "claim-1", sourceKey: "scenario:S-1", scenarioId: "S-1", status: "proven", ok: true, evidence: [], verifierNote: "Scenario passed" }],
    skipped: [],
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

  it("runs the verifier sidecar for the verify phase", async () => {
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

    const result = await runPhase("verify", {
      taskId: "T-1",
      runId: "run-1",
      phaseModel: DEFAULT_PHASE_MODELS.verify,
    }, deps);

    expect(result.ok).toBe(true);
    expect(runVerifierSidecar).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "T-1",
        runId: "run-1",
        cwd: "/tmp/pi-harness-phase-prompts",
        claimLedger,
        publishClaimsUpdated: claimPublisher.publishClaimsUpdated,
      }),
    );
  });

  it("fails verify when the verifier sidecar challenges a claim", async () => {
    vi.mocked(runVerifierSidecar).mockResolvedValueOnce({
      ok: false,
      taskId: "T-1",
      runId: "run-1",
      mode: "pending",
      verified: [{ claimId: "claim-1", sourceKey: "scenario:S-1", scenarioId: "S-1", status: "challenged", ok: false, evidence: [], verifierNote: "Scenario failed" }],
      skipped: [],
    });
    const deps: PhaseDeps = {
      cwd: "/tmp/pi-harness-phase-prompts",
      onEvent: () => {},
      createAgentSession: async (_opts: AgentSessionOptions) => {
        throw new Error("not used");
      },
      store: {},
      eventStore: {},
      claimLedger: { listClaims: vi.fn() },
      exec: async () => ({ ok: true, stdout: "" }),
    } as PhaseDeps;

    const result = await runPhase("verify", {
      taskId: "T-1",
      runId: "run-1",
      phaseModel: DEFAULT_PHASE_MODELS.verify,
    }, deps);

    expect(result).toMatchObject({
      ok: false,
      error: "verifier sidecar challenged 1 claim(s)",
    });
  });
});
