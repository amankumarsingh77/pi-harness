import type { Scenario, ScenarioResult } from "@pi-harness/shared";
import type { LegacyRunArtifactsStore } from "./artifacts-store.js";

// TODO(agentic-verify): the runner stubs ignore scenario shape and return a
// not-implemented result. The follow-up plan swaps these for a verifier agent.
type RunApi = (o: { scenario: Scenario; proofDir: string }) => Promise<ScenarioResult>;
type RunUi = (o: { scenario: Scenario; proofDir: string }) => Promise<ScenarioResult>;
type RunUiVisual = (o: { scenario: Scenario; proofDir: string }) => Promise<ScenarioResult>;

export type VerifyOpts = {
  taskId: string;
  runId: string;
  store: LegacyRunArtifactsStore;
  runApiScenario: RunApi;
  runUiScenario: RunUi;
  runUiVisualScenario: RunUiVisual;
};

export type VerifyResult = {
  ok: boolean;
  scenarios: ScenarioResult[];
  firstFailure?: ScenarioResult;
};

export async function runVerify(opts: VerifyOpts): Promise<VerifyResult> {
  const plan = await opts.store.readPlan(opts.taskId);
  const proofDir = opts.store.proofDir(opts.taskId);

  const results: ScenarioResult[] = [];
  for (const scenario of plan.verificationScenarios.scenarios) {
    let r: ScenarioResult;
    if (scenario.type === "api") r = await opts.runApiScenario({ scenario, proofDir });
    else if (scenario.type === "ui") r = await opts.runUiScenario({ scenario, proofDir });
    else r = await opts.runUiVisualScenario({ scenario, proofDir });
    results.push(r);
  }

  const ok = results.every((r) => r.ok);
  await opts.store.writeProofReport(opts.taskId, {
    runId: opts.runId,
    ok,
    scenarios: results,
    endedAt: new Date().toISOString(),
  });

  const firstFailure = results.find((r) => !r.ok);
  return {
    ok,
    scenarios: results,
    ...(firstFailure ? { firstFailure } : {}),
  };
}
