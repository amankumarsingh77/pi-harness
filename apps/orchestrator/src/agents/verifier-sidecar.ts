import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import {
  ClaimEvidenceSchema,
  ScenarioFileSchema,
  type ApiScenario,
  type Claim,
  type ClaimEvidence,
  type ClaimsUpdatedPayload,
  type Scenario,
  type ScenarioFile,
  type ScenarioResult,
  type UiScenario,
  type UiVisualScenario,
} from "@pi-harness/shared";
import type { ClaimLedgerStore } from "../adapters/mission-store.js";
import type { ArtifactsStore } from "./artifacts-store.js";

type RunApiScenario = (opts: {
  readonly scenario: ApiScenario;
  readonly proofDir: string;
}) => Promise<ScenarioResult>;

type RunUiScenario = (opts: {
  readonly scenario: UiScenario;
  readonly proofDir: string;
}) => Promise<ScenarioResult>;

type RunUiVisualScenario = (opts: {
  readonly scenario: UiVisualScenario;
  readonly proofDir: string;
}) => Promise<ScenarioResult>;

type ClaimPublisher = {
  readonly publishClaimsUpdated: (
    taskId: string,
    payload: ClaimsUpdatedPayload,
  ) => Promise<unknown>;
};

export const VerifierRunModeSchema = z.enum(["pending", "all"]);
export type VerifierRunMode = z.infer<typeof VerifierRunModeSchema>;

export const VerifierRunRequestSchema = z
  .object({
    claimIds: z.array(z.string().min(1)).optional(),
    mode: VerifierRunModeSchema.default("pending"),
  })
  .strict();

const SkippedReasonSchema = z.enum([
  "not_scenario_claim",
  "status_not_selected",
  "scenario_not_found",
]);

const VerifiedClaimSchema = z.object({
  claimId: z.string().min(1),
  sourceKey: z.string().min(1),
  scenarioId: z.string().min(1),
  status: z.enum(["proven", "challenged"]),
  ok: z.boolean(),
  evidence: z.array(ClaimEvidenceSchema),
  verifierNote: z.string().min(1),
  durationMs: z.number().optional(),
});

const SkippedClaimSchema = z.object({
  claimId: z.string().min(1),
  sourceKey: z.string().min(1),
  reason: SkippedReasonSchema,
});

export const VerifierSidecarResultSchema = z.object({
  ok: z.boolean(),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  mode: VerifierRunModeSchema,
  verified: z.array(VerifiedClaimSchema),
  skipped: z.array(SkippedClaimSchema),
  reportPath: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});
export type VerifierSidecarResult = z.infer<typeof VerifierSidecarResultSchema>;

export type VerifierSidecarOpts = {
  readonly taskId: string;
  readonly runId: string;
  readonly cwd: string;
  readonly store: ArtifactsStore;
  readonly claimLedger: ClaimLedgerStore;
  readonly publishClaimsUpdated?: ClaimPublisher["publishClaimsUpdated"];
  readonly mode?: VerifierRunMode;
  readonly claimIds?: readonly string[];
  readonly runApiScenario: RunApiScenario;
  readonly runUiScenario: RunUiScenario;
  readonly runUiVisualScenario: RunUiVisualScenario;
};

export async function runVerifierSidecar(
  opts: VerifierSidecarOpts,
): Promise<VerifierSidecarResult> {
  const mode = opts.mode ?? "pending";
  const claims = await opts.claimLedger.listClaims(opts.taskId);
  const selected = selectScenarioClaims({
    claims,
    mode,
    ...(opts.claimIds !== undefined ? { claimIds: opts.claimIds } : {}),
  });

  if (selected.runnable.length === 0) {
    return writeAndValidateReport(opts, {
      ok: true,
      taskId: opts.taskId,
      runId: opts.runId,
      mode,
      verified: [],
      skipped: selected.skipped,
    });
  }

  const scenariosResult = await readScenarioFile(opts);
  if (!scenariosResult.ok) {
    return VerifierSidecarResultSchema.parse({
      ok: false,
      taskId: opts.taskId,
      runId: opts.runId,
      mode,
      verified: [],
      skipped: selected.skipped,
      error: scenariosResult.error,
    });
  }

  const scenariosById = new Map(
    scenariosResult.scenarios.scenarios.map((scenario) => [scenario.id, scenario]),
  );
  const runnable = selected.runnable
    .map((claim) => ({ claim, scenarioId: scenarioIdForClaim(claim), scenario: scenariosById.get(scenarioIdForClaim(claim)) }))
    .filter(hasScenario);
  const missingScenario = selected.runnable
    .filter((claim) => !scenariosById.has(scenarioIdForClaim(claim)))
    .map((claim) => skippedClaim(claim, "scenario_not_found"));

  const verified: z.infer<typeof VerifiedClaimSchema>[] = [];
  for (const item of runnable) {
    const result = await runScenario(opts, item.scenario);
    const status: "proven" | "challenged" = result.ok ? "proven" : "challenged";
    const verifierNote = result.ok
      ? `Scenario passed: ${item.scenario.name}`
      : `Scenario failed: ${result.error ?? "unknown failure"}`;
    const evidence = evidenceForScenarioResult(opts.taskId, item.scenario.id, result);
    const mutation = await opts.claimLedger.updateClaimStatus(opts.taskId, item.claim.id, {
      status,
      verifierNote,
      evidence,
    });
    if (mutation.events.length > 0) {
      await opts.publishClaimsUpdated?.(opts.taskId, {
        taskId: opts.taskId,
        claims: mutation.claims,
        claimEvents: mutation.events,
      });
    }
    verified.push({
      claimId: item.claim.id,
      sourceKey: item.claim.sourceKey,
      scenarioId: item.scenario.id,
      status,
      ok: result.ok,
      evidence,
      verifierNote,
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    });
  }

  return writeAndValidateReport(opts, {
    ok: verified.every((item) => item.ok),
    taskId: opts.taskId,
    runId: opts.runId,
    mode,
    verified,
    skipped: [...selected.skipped, ...missingScenario],
  });
}

type ScenarioReadResult =
  | { readonly ok: true; readonly scenarios: ScenarioFile }
  | { readonly ok: false; readonly error: string };

async function readScenarioFile(opts: VerifierSidecarOpts): Promise<ScenarioReadResult> {
  const artifact = await opts.store.readArtifact(opts.cwd, opts.taskId, "scenarios");
  if (!artifact) return { ok: false, error: "scenarios.yaml not found" };
  try {
    return {
      ok: true,
      scenarios: ScenarioFileSchema.parse(yaml.load(artifact.body)),
    };
  } catch (err) {
    return { ok: false, error: `scenarios.yaml: ${(err as Error).message}` };
  }
}

function selectScenarioClaims(args: {
  readonly claims: readonly Claim[];
  readonly mode: VerifierRunMode;
  readonly claimIds?: readonly string[];
}): { readonly runnable: readonly Claim[]; readonly skipped: z.infer<typeof SkippedClaimSchema>[] } {
  const targetIds = args.claimIds ? new Set(args.claimIds) : null;
  const targeted = targetIds
    ? args.claims.filter((claim) => targetIds.has(claim.id))
    : args.claims.filter((claim) => claim.sourceKey.startsWith("scenario:"));
  const skipped = targeted
    .filter((claim) => !claim.sourceKey.startsWith("scenario:"))
    .map((claim) => skippedClaim(claim, "not_scenario_claim"));
  const scenarioClaims = targeted.filter((claim) => claim.sourceKey.startsWith("scenario:"));
  const runnable = scenarioClaims.filter((claim) =>
    targetIds !== null || args.mode === "all" || claim.status === "pending" || claim.status === "challenged",
  );
  const statusSkipped = scenarioClaims
    .filter((claim) => !runnable.some((item) => item.id === claim.id))
    .map((claim) => skippedClaim(claim, "status_not_selected"));
  return { runnable, skipped: [...skipped, ...statusSkipped] };
}

async function runScenario(
  opts: VerifierSidecarOpts,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const proofDir = join(opts.cwd, ".harness", opts.taskId, "proof");
  if (scenario.type === "api") return opts.runApiScenario({ scenario, proofDir });
  if (scenario.type === "ui") return opts.runUiScenario({ scenario, proofDir });
  return opts.runUiVisualScenario({ scenario, proofDir });
}

function evidenceForScenarioResult(
  taskId: string,
  scenarioId: string,
  result: ScenarioResult,
): ClaimEvidence[] {
  return [
    {
      kind: "scenario",
      ref: scenarioId,
      note: result.ok ? "passed" : result.error ?? "failed",
    },
    ...artifactEvidence(taskId, result),
  ];
}

function artifactEvidence(taskId: string, result: ScenarioResult): ClaimEvidence[] {
  const response = result.evidence.responseFile
    ? [{ kind: "artifact" as const, ref: proofRef(taskId, result.evidence.responseFile) }]
    : [];
  const screenshot = result.evidence.screenshotFile
    ? [{ kind: "screenshot" as const, ref: proofRef(taskId, result.evidence.screenshotFile) }]
    : [];
  return [...response, ...screenshot];
}

function proofRef(taskId: string, relPath: string): string {
  return [".harness", taskId, "proof", relPath.replace(/^\/+/, "")].join("/");
}

function scenarioIdForClaim(claim: Claim): string {
  return claim.sourceKey.slice("scenario:".length);
}

function skippedClaim(
  claim: Claim,
  reason: z.infer<typeof SkippedReasonSchema>,
): z.infer<typeof SkippedClaimSchema> {
  return { claimId: claim.id, sourceKey: claim.sourceKey, reason };
}

function hasScenario(
  item: { readonly claim: Claim; readonly scenarioId: string; readonly scenario: Scenario | undefined },
): item is { readonly claim: Claim; readonly scenarioId: string; readonly scenario: Scenario } {
  return item.scenario !== undefined;
}

async function writeAndValidateReport(
  opts: VerifierSidecarOpts,
  result: Omit<VerifierSidecarResult, "reportPath">,
): Promise<VerifierSidecarResult> {
  const reportPath = join(opts.cwd, ".harness", opts.taskId, "proof", "claim-verifier-report.json");
  const withReport = VerifierSidecarResultSchema.parse({
    ...result,
    reportPath,
  });
  await writeJsonAtomic(reportPath, withReport);
  await writeFileAtomic(
    join(opts.cwd, ".harness", opts.taskId, "proof", "claim-verifier-report.md"),
    reportMarkdown(withReport),
  );
  return withReport;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFileAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, value, "utf8");
  await rename(tmp, path);
}

function reportMarkdown(result: VerifierSidecarResult): string {
  return [
    "# Claim Verifier Report",
    "",
    `**Run:** \`${result.runId}\``,
    `**Result:** ${result.ok ? "pass" : "fail"}`,
    "",
    "## Verified",
    ...(result.verified.length === 0
      ? ["- none"]
      : result.verified.map(
          (item) => `- ${item.ok ? "PASS" : "FAIL"} ${item.sourceKey}: ${item.verifierNote}`,
        )),
    "",
    "## Skipped",
    ...(result.skipped.length === 0
      ? ["- none"]
      : result.skipped.map((item) => `- ${item.sourceKey}: ${item.reason}`)),
  ].join("\n");
}
