import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaimLedgerStore } from "../../src/adapters/mission-store.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { runVerifierSidecar } from "../../src/agents/verifier-sidecar.js";

describe("runVerifierSidecar", () => {
  it("marks passing scenario claims as proven with evidence and a report", async () => {
    const ctx = await makeContext();
    await writeScenarios(ctx.cwd, ctx.taskId, [
      scenarioYaml("S-001", "/ok"),
    ]);
    await ctx.claimLedger.syncPlannedClaims(ctx.taskId, [
      { sourceKey: "scenario:S-001", text: "Scenario ok passes", owner: "planner" },
    ]);
    const runApiScenario = vi.fn(async () => ({
      id: "S-001",
      type: "api" as const,
      ok: true,
      evidence: { status: 200, responseFile: "responses/S-001.json" },
      durationMs: 8,
    }));

    const result = await runVerifierSidecar({
      taskId: ctx.taskId,
      runId: "R-1",
      cwd: ctx.cwd,
      store: ctx.store,
      claimLedger: ctx.claimLedger,
      publishClaimsUpdated: ctx.publishClaimsUpdated,
      runApiScenario,
      runUiScenario: failingUiRunner,
      runUiVisualScenario: failingUiVisualRunner,
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toHaveLength(1);
    expect(runApiScenario).toHaveBeenCalledOnce();
    expect(await ctx.claimLedger.listClaims(ctx.taskId)).toMatchObject([
      {
        sourceKey: "scenario:S-001",
        status: "proven",
        evidence: [
          { kind: "scenario", ref: "S-001" },
          { kind: "artifact", ref: ".harness/T-001/proof/responses/S-001.json" },
        ],
      },
    ]);
    expect(ctx.publishClaimsUpdated).toHaveBeenCalledOnce();
    const report = JSON.parse(
      await readFile(join(ctx.cwd, ".harness", ctx.taskId, "proof", "claim-verifier-report.json"), "utf8"),
    );
    expect(report).toMatchObject({ ok: true, verified: [{ claimId: result.verified[0]?.claimId }] });

    await ctx.cleanup();
  });

  it("marks failing scenario claims as challenged without deleting existing evidence", async () => {
    const ctx = await makeContext();
    await writeScenarios(ctx.cwd, ctx.taskId, [
      scenarioYaml("S-002", "/fail"),
    ]);
    await ctx.claimLedger.syncPlannedClaims(ctx.taskId, [
      { sourceKey: "scenario:S-002", text: "Scenario fail is checked", owner: "planner" },
    ]);
    const [claim] = await ctx.claimLedger.listClaims(ctx.taskId);
    if (!claim) throw new Error("expected seeded claim");
    await ctx.claimLedger.updateClaimStatus(ctx.taskId, claim.id, {
      status: "challenged",
      evidence: [{ kind: "manual", ref: "initial-note" }],
    });

    const result = await runVerifierSidecar({
      taskId: ctx.taskId,
      runId: "R-1",
      cwd: ctx.cwd,
      store: ctx.store,
      claimLedger: ctx.claimLedger,
      publishClaimsUpdated: ctx.publishClaimsUpdated,
      runApiScenario: async () => ({
        id: "S-002",
        type: "api",
        ok: false,
        error: "expected status 200, got 500",
        evidence: { status: 500, responseFile: "responses/S-002.json" },
        durationMs: 11,
      }),
      runUiScenario: failingUiRunner,
      runUiVisualScenario: failingUiVisualRunner,
    });

    expect(result.ok).toBe(false);
    expect(result.verified[0]).toMatchObject({ status: "challenged" });
    expect(await ctx.claimLedger.listClaims(ctx.taskId)).toMatchObject([
      {
        sourceKey: "scenario:S-002",
        status: "challenged",
        evidence: [
          { kind: "manual", ref: "initial-note" },
          { kind: "scenario", ref: "S-002" },
          { kind: "artifact", ref: ".harness/T-001/proof/responses/S-002.json" },
        ],
        verifierNote: "Scenario failed: expected status 200, got 500",
      },
    ]);

    await ctx.cleanup();
  });

  it("fails missing or malformed scenarios without mutating claims", async () => {
    const ctx = await makeContext();
    await ctx.claimLedger.syncPlannedClaims(ctx.taskId, [
      { sourceKey: "scenario:S-003", text: "Scenario exists", owner: "planner" },
    ]);

    const result = await runVerifierSidecar({
      taskId: ctx.taskId,
      runId: "R-1",
      cwd: ctx.cwd,
      store: ctx.store,
      claimLedger: ctx.claimLedger,
      publishClaimsUpdated: ctx.publishClaimsUpdated,
      runApiScenario: async () => {
        throw new Error("should not run");
      },
      runUiScenario: failingUiRunner,
      runUiVisualScenario: failingUiVisualRunner,
    });

    expect(result).toMatchObject({ ok: false, error: "scenarios.yaml not found" });
    expect(await ctx.claimLedger.listClaims(ctx.taskId)).toMatchObject([
      { sourceKey: "scenario:S-003", status: "pending", evidence: [] },
    ]);
    expect(ctx.publishClaimsUpdated).not.toHaveBeenCalled();

    await ctx.cleanup();
  });

  it("skips missing scenario ids and proven claims unless mode all is requested", async () => {
    const ctx = await makeContext();
    await writeScenarios(ctx.cwd, ctx.taskId, [
      scenarioYaml("S-004", "/ok"),
    ]);
    await ctx.claimLedger.syncPlannedClaims(ctx.taskId, [
      { sourceKey: "scenario:S-004", text: "Known scenario", owner: "planner" },
      { sourceKey: "scenario:S-404", text: "Deleted scenario", owner: "planner" },
      { sourceKey: "execution-dag:C-001", text: "DAG claim", owner: "planner" },
    ]);
    const known = (await ctx.claimLedger.listClaims(ctx.taskId)).find(
      (claim) => claim.sourceKey === "scenario:S-004",
    );
    if (!known) throw new Error("expected known claim");
    await ctx.claimLedger.updateClaimStatus(ctx.taskId, known.id, { status: "proven" });
    const runApiScenario = vi.fn(async () => ({
      id: "S-004",
      type: "api" as const,
      ok: true,
      evidence: {},
      durationMs: 4,
    }));

    const pendingResult = await runVerifierSidecar({
      taskId: ctx.taskId,
      runId: "R-1",
      cwd: ctx.cwd,
      store: ctx.store,
      claimLedger: ctx.claimLedger,
      publishClaimsUpdated: ctx.publishClaimsUpdated,
      runApiScenario,
      runUiScenario: failingUiRunner,
      runUiVisualScenario: failingUiVisualRunner,
    });
    const allResult = await runVerifierSidecar({
      taskId: ctx.taskId,
      runId: "R-2",
      cwd: ctx.cwd,
      store: ctx.store,
      claimLedger: ctx.claimLedger,
      publishClaimsUpdated: ctx.publishClaimsUpdated,
      mode: "all",
      runApiScenario,
      runUiScenario: failingUiRunner,
      runUiVisualScenario: failingUiVisualRunner,
    });

    expect(pendingResult).toMatchObject({
      ok: true,
      verified: [],
      skipped: [
        { sourceKey: "scenario:S-004", reason: "status_not_selected" },
        { sourceKey: "scenario:S-404", reason: "scenario_not_found" },
      ],
    });
    expect(allResult.ok).toBe(true);
    expect(allResult.verified).toHaveLength(1);
    expect(runApiScenario).toHaveBeenCalledOnce();

    await ctx.cleanup();
  });
});

async function makeContext(): Promise<{
  readonly cwd: string;
  readonly taskId: string;
  readonly store: ArtifactsStore;
  readonly claimLedger: ClaimLedgerStore;
  readonly publishClaimsUpdated: ReturnType<typeof vi.fn>;
  readonly cleanup: () => Promise<void>;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-harness-verifier-"));
  const stateDir = join(cwd, ".state");
  return {
    cwd,
    taskId: "T-001",
    store: new ArtifactsStore(),
    claimLedger: new ClaimLedgerStore({ stateDir }),
    publishClaimsUpdated: vi.fn(async () => undefined),
    cleanup: () => rm(cwd, { recursive: true, force: true }),
  };
}

async function writeScenarios(
  cwd: string,
  taskId: string,
  scenarios: readonly string[],
): Promise<void> {
  const body = ["scenarios:", ...scenarios].join("\n");
  await new ArtifactsStore().writeArtifact(cwd, taskId, {
    fm: {
      task: taskId,
      kind: "scenarios",
      parent: "plan.md",
      status: "ready",
      branch: `pi/${taskId}`,
      last_updated: "2026-05-20T00:00:00.000Z",
      last_updated_by: "test",
    },
    body,
  });
}

function scenarioYaml(id: string, hint: string): string {
  return [
    `  - id: ${id}`,
    "    type: api",
    `    name: ${id} scenario`,
    `    description: Exercise ${hint} and verify it responds with a 200 and the expected body.`,
  ].join("\n");
}

async function failingUiRunner() {
  throw new Error("ui runner should not run");
}

async function failingUiVisualRunner() {
  throw new Error("ui visual runner should not run");
}
