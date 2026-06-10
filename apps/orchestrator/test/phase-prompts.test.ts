import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHASE_MODELS, type ClaimsUpdatedPayload } from "@pi-harness/shared";
import type { AgentSessionOptions } from "@pi-harness/pi-bridge";
import { runPlan } from "../src/agents/plan.js";
import { runVerifierSidecar } from "../src/agents/verifier-sidecar.js";
import type { PhaseDeps } from "../src/runner/phase-prompts.js";
import { runPhase } from "../src/runner/phase-prompts.js";
import type { ManagedSessionFactory, ManagedSessionScope } from "../src/runner/phase-session-manager.js";

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
    const scopes: ManagedSessionScope[] = [];
    const sessionFactory = fakeSessionFactory("plan", scopes);
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
      sessionFactory,
      ticketTitle: "Plan task",
      ticketDescription: "Plan description",
    }, deps);

    expect(runPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        claimLedger,
        claimPublisher,
        sessionFactory,
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
        publishClaimsUpdated: expect.any(Function),
      }),
    );
  });

  it("passes a bound claim publisher into the verifier sidecar", async () => {
    const published: ClaimsUpdatedPayload[] = [];
    const claimPublisher = {
      published,
      async publishClaimsUpdated(
        this: { readonly published: ClaimsUpdatedPayload[] },
        _taskId: string,
        payload: ClaimsUpdatedPayload,
      ): Promise<void> {
        this.published.push(payload);
      },
    };
    const deps: PhaseDeps = {
      cwd: "/tmp/pi-harness-phase-prompts",
      onEvent: () => {},
      createAgentSession: async (_opts: AgentSessionOptions) => {
        throw new Error("not used");
      },
      store: {},
      eventStore: {},
      claimLedger: { listClaims: vi.fn() },
      claimPublisher,
      exec: async () => ({ ok: true, stdout: "" }),
    } as PhaseDeps;

    await runPhase("verify", {
      taskId: "T-1",
      runId: "run-1",
      phaseModel: DEFAULT_PHASE_MODELS.verify,
    }, deps);

    const verifierOpts = vi.mocked(runVerifierSidecar).mock.calls.at(-1)?.[0];
    if (!verifierOpts?.publishClaimsUpdated) throw new Error("publishClaimsUpdated was not passed");
    const payload: ClaimsUpdatedPayload = {
      taskId: "T-1",
      claims: [],
      claimEvents: [],
    };

    await verifierOpts.publishClaimsUpdated("T-1", payload);

    expect(published).toEqual([payload]);
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

  it("opens verify through the managed main session when provided", async () => {
    const scopes: ManagedSessionScope[] = [];
    const deps: PhaseDeps = {
      cwd: "/tmp/pi-harness-phase-prompts",
      onEvent: () => {},
      createAgentSession: async (_opts: AgentSessionOptions) => {
        throw new Error("not used");
      },
      store: {},
      eventStore: { append: vi.fn(async () => {}) },
      claimLedger: { listClaims: vi.fn() },
      exec: async () => ({ ok: true, stdout: "" }),
    } as PhaseDeps;

    const result = await runPhase("verify", {
      taskId: "T-1",
      runId: "run-1",
      phaseModel: DEFAULT_PHASE_MODELS.verify,
      sessionFactory: fakeSessionFactory("verify", scopes),
    }, deps);

    expect(result.ok).toBe(true);
    expect(scopes).toEqual([{ kind: "main" }]);
  });

  it("opens pr through the managed main session and creates the pull request", async () => {
    const scopes: ManagedSessionScope[] = [];
    const exec = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "push") return { ok: true, stdout: "" };
      if (cmd === "gh" && args[0] === "pr") return { ok: true, stdout: "https://github.com/x/y/pull/42\n" };
      return { ok: false, stdout: "", stderr: "unexpected" };
    });
    const deps: PhaseDeps = {
      cwd: "/tmp/pi-harness-phase-prompts",
      onEvent: () => {},
      createAgentSession: async (_opts: AgentSessionOptions) => {
        throw new Error("not used");
      },
      store: {},
      eventStore: { append: vi.fn(async () => {}) },
      exec,
    } as PhaseDeps;

    const result = await runPhase("pr", {
      taskId: "T-1",
      runId: "run-1",
      branch: "pi/T-1",
      phaseModel: DEFAULT_PHASE_MODELS.pr,
      sessionFactory: fakeSessionFactory("pr", scopes),
    }, deps);

    expect(result).toMatchObject({ ok: true, prUrl: "https://github.com/x/y/pull/42" });
    expect(scopes).toEqual([{ kind: "main" }]);
    expect(exec).toHaveBeenCalledWith("git", ["push", "-u", "origin", "pi/T-1"], { cwd: "/tmp/pi-harness-phase-prompts" });
  });
});

function fakeSessionFactory(
  phase: ManagedSessionFactory["phase"],
  scopes: ManagedSessionScope[],
): ManagedSessionFactory {
  return {
    phase,
    mainPath: `/tmp/${phase}.jsonl`,
    pathFor: (scope) => `/tmp/${phase}-${scope.kind}.jsonl`,
    open: async (scope) => {
      scopes.push(scope);
      return {
        async prompt() {
          return { inputTokens: 1, outputTokens: 1, costUsd: 0.001 };
        },
        async abort() {},
        async close() {},
      };
    },
  };
}
