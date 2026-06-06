import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import yaml from "js-yaml";
import {
  BlastRadiusFileSchema,
  ExecutionDagSchema,
  ScenarioFileSchema,
  type Artifact,
  type ArtifactKind,
  type ClaimsUpdatedPayload,
} from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { PlanEventBus } from "./plan-event-bus.js";
import type {
  ClaimLedgerMutationResult,
  ClaimLedgerStore,
  PlannedClaimInput,
} from "../adapters/mission-store.js";

// Mirrors the SDK's AgentToolResult shape — same as brainstorm-tools.ts.
type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  details: T;
  terminate?: boolean;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

const MarkReadyParams = Type.Object({});
const WritablePlanArtifactKindParam = Type.Union([
  Type.Literal("plan"),
  Type.Literal("phase-plan"),
  Type.Literal("scenarios"),
  Type.Literal("blast-radius"),
  Type.Literal("execution-dag"),
]);

const WritePlanArtifactParams = Type.Object({
  kind: WritablePlanArtifactKindParam,
  phase: Type.Optional(Type.Integer({ minimum: 1 })),
  body: Type.String({ minLength: 1, maxLength: 500_000 }),
});

export type MarkReadyDetails = { ok: boolean; missing?: string };
export type WritablePlanArtifactKind = Extract<
  ArtifactKind,
  "plan" | "phase-plan" | "scenarios" | "blast-radius" | "execution-dag"
>;
export type WritePlanArtifactDetails = {
  readonly ok: boolean;
  readonly kind: WritablePlanArtifactKind;
  readonly phase?: number;
  readonly path?: string;
  readonly bytes?: number;
  readonly error?: string;
};

// Required prose sections in plan.md (heading literal + non-empty body
// underneath). The planner system prompt enumerates these; the tool enforces
// them so a malformed plan can't slip through to the approval gate.
export const PLAN_REQUIRED_SECTIONS = [
  "## Goal",
  "## Patterns to follow",
  "## Touchpoints",
  "## Blast radius",
  "## Precedent warnings",
  "## Steps",
  "## Out of scope",
] as const;

export const PLAN_OVERVIEW_REQUIRED_SECTIONS = [
  "## Goal",
  "## Plan Summary",
  "## Phase DAG",
  "## Phases",
  "## Cross-Phase Risks",
  "## Out of scope",
] as const;

export const PHASE_PLAN_REQUIRED_SECTIONS = [
  "## Objective",
  "## Decisions",
  "## Touchpoints",
  "## Work Slices",
  "## Phase Verification Contract",
  "## Failure Modes",
  "## Exit Criteria",
] as const;

// claim-verifier dispatch state, scoped to one runPlan invocation. The handler
// receives this so the cap is enforced *across* multiple mark_ready calls
// within the same run (each rejected mark_ready leaves the agent free to fix
// and retry, but each retry shouldn't re-dispatch claim-verifier from scratch).
export type ClaimVerifierState = {
  attempts: number;        // capped at 2 by the handler
  cap: number;             // default 2
};

export type ClaimVerifierResult = {
  // Findings file at .harness/<taskId>/research/claim-verifier.md is the
  // canonical anchor; the result the runner returns is just whether any
  // claim was Falsified, parsed from that file.
  falsifiedClaims: string[];
  // True when the subagent actually wrote findings to disk. False means the
  // session ended without producing a findings file (e.g. the model returned
  // text only, or hit an error). Treating that as "audit passed" is unsafe —
  // mark_ready rejects so the planner has to dispatch again.
  findingsWritten: boolean;
  // True when the dispatch was cut short by the parent planner timeout. The
  // tool must NOT flip status to ready in this case — the run is being torn
  // down. mark_ready returns a reject so the planner sees the audit failed.
  aborted?: boolean;
};

export type DispatchClaimVerifier = (planBody: string) => Promise<ClaimVerifierResult>;

export type ClaimPublisher = {
  publishClaimsUpdated: (
    taskId: string,
    payload: ClaimsUpdatedPayload,
  ) => Promise<unknown>;
};

function startsWithYamlFrontmatter(body: string): boolean {
  return body.trimStart().startsWith("---\n") || body.trimStart() === "---";
}

export function makeWritePlanArtifactTool(deps: {
  store: ArtifactsStore;
  cwd: string;
  taskId: string;
}): ToolLike<typeof WritePlanArtifactParams, WritePlanArtifactDetails> {
  const { store, cwd, taskId } = deps;

  function fail(
    params: Static<typeof WritePlanArtifactParams>,
    error: string,
  ): ToolResult<WritePlanArtifactDetails> {
    return {
      content: [{ type: "text", text: error }],
      details: {
        ok: false,
        kind: params.kind,
        ...(params.phase !== undefined ? { phase: params.phase } : {}),
        error,
      },
    };
  }

  return {
    name: "write_plan_artifact",
    label: "Write plan artifact body",
    description:
      "Replace a plan-phase artifact body while preserving harness-owned frontmatter. For phase-plan, pass a positive phase number and markdown body. Do not include YAML frontmatter.",
    parameters: WritePlanArtifactParams,
    async execute(_id, params) {
      if (startsWithYamlFrontmatter(params.body)) {
        return fail(params, "artifact body must not include YAML frontmatter");
      }

      if (params.kind === "phase-plan") {
        if (params.phase === undefined) {
          return fail(params, "phase-plan requires a positive integer phase");
        }
        const current = await store.readPhasePlanArtifact(cwd, taskId, params.phase);
        const artifact: Artifact = {
          fm: current?.fm ?? {
            task: taskId,
            kind: "phase-plan",
            parent: "plan.md",
            phase: params.phase,
            status: "draft",
            branch: `pi/${taskId}`,
            last_updated: new Date().toISOString(),
            last_updated_by: "plan-agent",
          },
          body: params.body,
        };
        await store.writeArtifact(cwd, taskId, artifact);
        const path = store.phasePlanArtifactPath(cwd, taskId, params.phase);
        return {
          content: [{ type: "text", text: `wrote plan-${params.phase}.md body` }],
          details: {
            ok: true,
            kind: params.kind,
            phase: params.phase,
            path,
            bytes: params.body.length,
          },
        };
      }

      if (params.phase !== undefined) {
        return fail(params, "phase is only valid for phase-plan artifacts");
      }

      const current = await store.readArtifact(cwd, taskId, params.kind);
      if (!current) {
        return fail(params, `${params.kind} artifact not found`);
      }
      await store.writeArtifact(cwd, taskId, { fm: current.fm, body: params.body });
      const path = store.artifactPath(cwd, taskId, params.kind);
      return {
        content: [{ type: "text", text: `wrote ${params.kind} body` }],
        details: {
          ok: true,
          kind: params.kind,
          path,
          bytes: params.body.length,
        },
      };
    },
  };
}

export function makeMarkReadyTool(deps: {
  store: ArtifactsStore;
  bus: PlanEventBus;
  cwd: string;
  taskId: string;
  dispatchClaimVerifier: DispatchClaimVerifier;
  claimVerifierState: ClaimVerifierState;
  claimLedger?: ClaimLedgerStore;
  claimPublisher?: ClaimPublisher;
  // Fires when the planner stage's timeout/cancel cuts the run short. If set
  // and aborted at any point during mark_ready, the tool refuses to flip
  // artifact status to ready — otherwise a slow audit can finish *after* the
  // blocked event was published and silently promote the run.
  cancelSignal?: AbortSignal;
}): ToolLike<typeof MarkReadyParams, MarkReadyDetails> {
  const {
    store,
    bus,
    cwd,
    taskId,
    dispatchClaimVerifier,
    claimVerifierState,
    claimLedger,
    claimPublisher,
    cancelSignal,
  } = deps;

  function reject(missing: string): ToolResult<MarkReadyDetails> {
    return {
      content: [{ type: "text", text: missing }],
      details: { ok: false, missing },
    };
  }

  return {
    name: "mark_ready",
    label: "Mark plan ready",
    description:
      "Signal that plan.md, scenarios.yaml, and blast-radius.yaml are complete. The harness validates required sections, parses YAML artifacts against their schemas, and dispatches claim-verifier (capped at 2 attempts) before flipping artifact status to ready.",
    parameters: MarkReadyParams,
    async execute() {
      // 1. Load both artifacts.
      const plan = await store.readArtifact(cwd, taskId, "plan");
      if (!plan) return reject("plan.md not found");
      const scenarios = await store.readArtifact(cwd, taskId, "scenarios");
      if (!scenarios) return reject("scenarios.yaml not found");
      const blastRadius = await store.readArtifact(cwd, taskId, "blast-radius");
      if (!blastRadius) return reject("blast-radius.yaml not found");
      const executionDag = await store.readArtifact(cwd, taskId, "execution-dag");
      if (!executionDag) return reject("execution-dag.yaml not found");
      const phasePlans = await store.listPhasePlanArtifacts(cwd, taskId);

      // 2. Frontmatter status invariant: must be draft or ready.
      for (const [name, art] of [
        ["plan.md", plan],
        ...phasePlans.map((art) => [`plan-${art.fm.phase}.md`, art] as const),
        ["scenarios.yaml", scenarios],
        ["blast-radius.yaml", blastRadius],
        ["execution-dag.yaml", executionDag],
      ] as const) {
        if (art.fm.status !== "draft" && art.fm.status !== "ready") {
          return reject(`${name} frontmatter status invalid (got: ${art.fm.status})`);
        }
      }

      // 3. plan.md required sections.
      const missingSection = findMissingSection(plan.body);
      if (missingSection) return reject(missingSection);
      const phasePlanRefError = validateReferencedPhasePlans(plan.body, phasePlans);
      if (phasePlanRefError) return reject(phasePlanRefError);
      const phasePlanSectionError = validatePhasePlanSections(phasePlans);
      if (phasePlanSectionError) return reject(phasePlanSectionError);

      // 4. scenarios.yaml schema.
      const scenariosError = validateScenariosYaml(scenarios.body);
      if (scenariosError) return reject(`scenarios.yaml: ${scenariosError}`);
      const blastRadiusError = validateBlastRadiusYaml(blastRadius.body);
      if (blastRadiusError) return reject(`blast-radius.yaml: ${blastRadiusError}`);
      const executionDagError = validateExecutionDagYaml(executionDag.body);
      if (executionDagError) return reject(`execution-dag.yaml: ${executionDagError}`);
      const planDagError = validatePlanStepsCoveredByDag(plan.body, executionDag.body);
      if (planDagError) return reject(`execution-dag.yaml: ${planDagError}`);
      const phasePlanDagError = validatePhasePlanStepsCoveredByDag(phasePlans, executionDag.body);
      if (phasePlanDagError) return reject(`execution-dag.yaml: ${phasePlanDagError}`);

      // 5. claim-verifier gate. The vendored claim-verifier subagent reviews
      //    plan.md for unsupported claims; if any come back Falsified the
      //    planner must revise. Capped per run so a perpetual loop can't burn
      //    cost: after 2 attempts the phase fails into plan_failed.
      const claimsResult = await runClaimVerifier({
        cwd,
        taskId,
        planBody: combinedPlanBody(plan, phasePlans),
        dispatchClaimVerifier,
        state: claimVerifierState,
      });
      if (claimsResult.kind === "exhausted") {
        return reject(claimsResult.message);
      }
      if (claimsResult.kind === "aborted") {
        // Parent planner timed out / cancelled during the audit. Do NOT flip
        // status to ready — the run is being torn down. The planner stage's
        // timeout handler has already published the blocked event with reason.
        return reject(
          "claim-verifier: aborted by planner timeout — plan not promoted to ready",
        );
      }
      if (claimsResult.kind === "no_findings") {
        return reject(
          `claim-verifier: subagent ended without writing findings. Call mark_ready again — it will re-dispatch claim-verifier (until the cap of ${claimVerifierState.cap} attempts).`,
        );
      }
      if (claimsResult.kind === "falsified") {
        return reject(
          `claim-verifier: ${claimsResult.claims[0]} — re-evaluate or remove (${claimsResult.claims.length} flagged)`,
        );
      }

      if (cancelSignal?.aborted) {
        return reject(
          "mark_ready: planner aborted before promotion — plan not flipped to ready",
        );
      }

      await syncPlanClaims({
        taskId,
        claimLedger,
        claimPublisher,
        executionDagBody: executionDag.body,
        scenariosBody: scenarios.body,
      });

      // Already-ready: skip the status flip but still terminate.
      const alreadyReady =
        plan.fm.status === "ready" &&
        phasePlans.every((artifact) => artifact.fm.status === "ready") &&
        scenarios.fm.status === "ready" &&
        blastRadius.fm.status === "ready" &&
        executionDag.fm.status === "ready";
      if (alreadyReady) {
        return {
          content: [{ type: "text", text: "ready" }],
          details: { ok: true },
          terminate: true,
        };
      }

      // 6. Flip both artifacts to ready, write back, publish status_changed.
      const now = new Date().toISOString();
      for (const cur of [plan, ...phasePlans, scenarios, blastRadius, executionDag] as const) {
        const next: Artifact = {
          fm: {
            ...cur.fm,
            status: "ready",
            last_updated: now,
            last_updated_by: "plan-agent",
          },
          body: cur.body,
        };
        await store.writeArtifact(cwd, taskId, next);
      }

      await bus.publish({
        kind: "plan_system",
        systemKind: "status_changed",
        data: { status: "ready" },
      });

      return {
        content: [{ type: "text", text: "ready" }],
        details: { ok: true },
        terminate: true,
      };
    },
  };
}

async function syncPlanClaims(args: {
  taskId: string;
  claimLedger: ClaimLedgerStore | undefined;
  claimPublisher: ClaimPublisher | undefined;
  executionDagBody: string;
  scenariosBody: string;
}): Promise<void> {
  if (!args.claimLedger) return;
  const result: ClaimLedgerMutationResult = await args.claimLedger.syncPlannedClaims(args.taskId, [
    ...plannedClaimsFromExecutionDag(args.executionDagBody),
    ...plannedClaimsFromScenarios(args.scenariosBody),
  ]);
  if (result.events.length === 0) return;
  await args.claimPublisher?.publishClaimsUpdated(args.taskId, {
    taskId: args.taskId,
    claims: result.claims,
    claimEvents: result.events,
  });
}

function plannedClaimsFromExecutionDag(body: string): PlannedClaimInput[] {
  const parsed = ExecutionDagSchema.parse(yaml.load(body));
  return parsed.nodes.map((node) => ({
    sourceKey: `execution-dag:${node.id}`,
    text: node.assertion,
    owner: "planner",
  }));
}

function plannedClaimsFromScenarios(body: string): PlannedClaimInput[] {
  const parsed = ScenarioFileSchema.parse(yaml.load(body));
  return parsed.scenarios.map((scenario) => ({
    sourceKey: `scenario:${scenario.id}`,
    text: `Scenario ${scenario.name} must pass`,
    owner: "planner",
  }));
}

// Returns the first missing-section error string for plan.md, or null if all
// PLAN_REQUIRED_SECTIONS are present with non-empty bodies. Same body-empty
// rule as brainstorm-tools.findMissingSection: a section's body runs from
// after its heading line to the next "## " heading (or EOF) and must contain
// at least one non-whitespace character.
function findMissingSection(body: string): string | null {
  const legacyMissing = findMissingSectionFrom(body, PLAN_REQUIRED_SECTIONS, "plan.md");
  if (legacyMissing === null) return null;

  const overviewMissing = findMissingSectionFrom(body, PLAN_OVERVIEW_REQUIRED_SECTIONS, "plan.md");
  if (overviewMissing === null) return null;
  if (body.includes("## Phases") || body.match(/\bplan-\d+\.md\b/)) return overviewMissing;
  return legacyMissing;
}

function findMissingSectionFrom(
  body: string,
  headings: readonly string[],
  name: string,
): string | null {
  const lines = body.split("\n");
  for (const heading of headings) {
    const headingIdx = lines.findIndex((l) => l.trim() === heading);
    if (headingIdx === -1) {
      return `${name} missing: ${heading}`;
    }
    let hasContent = false;
    for (let i = headingIdx + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (line.startsWith("## ")) break;
      if (line.trim().length > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      return `${name} missing: ${heading} (empty)`;
    }
  }
  return null;
}

function validateReferencedPhasePlans(
  planBody: string,
  phasePlans: readonly Artifact[],
): string | null {
  const phases = new Set(phasePlans.map((artifact) => artifact.fm.phase).filter(isNumber));
  const missing = extractReferencedPhaseNumbers(planBody).filter((phase) => !phases.has(phase));
  return missing.length > 0
    ? `plan.md references missing phase plan: ${artifactFileNameForPhase(missing[0]!)}`
    : null;
}

function validatePhasePlanSections(phasePlans: readonly Artifact[]): string | null {
  for (const artifact of phasePlans) {
    const phase = artifact.fm.phase;
    const name = phase === undefined ? "phase plan" : artifactFileNameForPhase(phase);
    const missing = findMissingSectionFrom(artifact.body, PHASE_PLAN_REQUIRED_SECTIONS, name);
    if (missing) return missing;
  }
  return null;
}

function validatePhasePlanStepsCoveredByDag(
  phasePlans: readonly Artifact[],
  executionDagBody: string,
): string | null {
  const stepIds = [...new Set(phasePlans.flatMap((artifact) => extractPlanStepIds(artifact.body)))];
  if (stepIds.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(executionDagBody);
  } catch {
    return null;
  }
  const dag = ExecutionDagSchema.safeParse(parsed);
  if (!dag.success) return null;
  const dagIds = new Set(dag.data.nodes.map((node) => node.id));
  const missing = stepIds.filter((id) => !dagIds.has(id));
  return missing.length > 0
    ? `phase plan step(s) missing matching DAG node(s): ${missing.join(", ")}`
    : null;
}

function combinedPlanBody(plan: Artifact, phasePlans: readonly Artifact[]): string {
  return [
    "# plan.md",
    plan.body,
    ...phasePlans.flatMap((artifact) => [
      "",
      `# ${artifactFileNameForPhase(artifact.fm.phase ?? 0)}`,
      artifact.body,
    ]),
  ].join("\n");
}

// Parse the scenarios.yaml *body* (frontmatter already stripped by
// parseArtifact) and validate against ScenarioFileSchema. Returns null on
// success, an error message string on failure.
function validateScenariosYaml(body: string): string | null {
  return validateYamlBody(body, ScenarioFileSchema);
}

function validateBlastRadiusYaml(body: string): string | null {
  return validateYamlBody(body, BlastRadiusFileSchema);
}

export function validateExecutionDagYaml(body: string): string | null {
  return validateYamlBody(body, ExecutionDagSchema);
}

function validateYamlBody(
  body: string,
  schema: typeof ScenarioFileSchema | typeof BlastRadiusFileSchema | typeof ExecutionDagSchema,
): string | null {
  let parsed: unknown;
  try {
    parsed = yaml.load(body);
  } catch (err) {
    return `YAML parse error: ${(err as Error).message}`;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    if (!first) return "schema validation failed";
    const path = first.path.length > 0 ? first.path.join(".") : "(root)";
    return `${path}: ${first.message}`;
  }
  return null;
}

function validatePlanStepsCoveredByDag(planBody: string, executionDagBody: string): string | null {
  const stepIds = extractPlanStepIds(planBody);
  if (stepIds.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(executionDagBody);
  } catch {
    return null;
  }
  const dag = ExecutionDagSchema.safeParse(parsed);
  if (!dag.success) return null;
  const dagIds = new Set(dag.data.nodes.map((node) => node.id));
  const missing = stepIds.filter((id) => !dagIds.has(id));
  return missing.length > 0
    ? `plan step(s) missing matching DAG node(s): ${missing.join(", ")}`
    : null;
}

function extractPlanStepIds(planBody: string): string[] {
  return planBody
    .split("\n")
    .map((line) => line.match(/^\s*(?:#{1,6}\s+|\d+\.\s+|-\s+)?(C-\d+)\b/)?.[1])
    .filter((id): id is string => id !== undefined);
}

function extractReferencedPhaseNumbers(body: string): number[] {
  return [...body.matchAll(/\bplan-(\d+)\.md\b/g)]
    .map((match) => Number.parseInt(match[1] ?? "", 10))
    .filter((phase) => Number.isInteger(phase) && phase > 0);
}

function artifactFileNameForPhase(phase: number): string {
  return `plan-${phase}.md`;
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}

type ClaimVerifierOutcome =
  | { kind: "ok" }
  | { kind: "falsified"; claims: string[] }
  | { kind: "no_findings" }
  | { kind: "aborted" }
  | { kind: "exhausted"; message: string };

async function runClaimVerifier(args: {
  cwd: string;
  taskId: string;
  planBody: string;
  dispatchClaimVerifier: DispatchClaimVerifier;
  state: ClaimVerifierState;
}): Promise<ClaimVerifierOutcome> {
  const { cwd, taskId, planBody, dispatchClaimVerifier, state } = args;
  const findingsPath = join(cwd, ".harness", taskId, "research", "claim-verifier.md");

  // If a previous mark_ready already produced findings, parse those instead
  // of re-dispatching. The agent has had a chance to address them; we evaluate
  // the file as-is.
  if (existsSync(findingsPath)) {
    const findings = readFileSync(findingsPath, "utf8");
    const claims = parseFalsifiedClaims(findings);
    if (claims.length === 0) return { kind: "ok" };
    // Need a re-dispatch only if the agent has said it fixed the issues
    // (re-running mark_ready). But we don't know that yet — caller should
    // archive/delete the file before retrying. For now, re-dispatch up to cap.
  }

  if (state.attempts >= state.cap) {
    return {
      kind: "exhausted",
      message: `claim-verifier exhausted (${state.cap} attempts) — phase will fail`,
    };
  }
  state.attempts += 1;

  const result = await dispatchClaimVerifier(planBody);
  if (result.aborted) return { kind: "aborted" };
  if (!result.findingsWritten) return { kind: "no_findings" };
  if (result.falsifiedClaims.length === 0) return { kind: "ok" };
  return { kind: "falsified", claims: result.falsifiedClaims };
}

// Parse the claim-verifier subagent's findings markdown for entries tagged
// `Falsified`. The vendored prompt's output convention uses a header per
// claim with a status line; we look for "Falsified" appearing on the same
// or following few lines after a claim header. Conservative: any line whose
// trimmed text starts with `Falsified` registers the most recent header text
// (preceding non-empty `## ` or `### ` line) as a falsified claim.
function parseFalsifiedClaims(findings: string): string[] {
  const lines = findings.split("\n");
  const out: string[] = [];
  let lastHeader: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const row = parseFindingRow(line);
    if (row && row.tag === "Falsified") {
      out.push(`${row.id}: ${row.justification}`);
      continue;
    }
    if (line.startsWith("### ") || line.startsWith("## ")) {
      lastHeader = line.replace(/^#+\s+/, "");
      continue;
    }
    if (/^(\*\*)?Falsified/i.test(line) && lastHeader) {
      out.push(lastHeader);
    }
  }
  return out;
}

function parseFindingRow(line: string): {
  id: string;
  tag: "Verified" | "Weakened" | "Falsified";
  justification: string;
} | null {
  if (!line.startsWith("FINDING ")) return null;
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length < 3) return null;
  const id = parts[0]!.replace(/^FINDING\s+/, "").trim();
  const tag = parts[1];
  const justification = parts.slice(2).join(" | ").trim();
  if (id.length === 0 || justification.length === 0) return null;
  if (tag !== "Verified" && tag !== "Weakened" && tag !== "Falsified") return null;
  return { id, tag, justification };
}

// Re-export for convenience: tests use these to construct fixtures and assert
// the same constants the tool consumes.
export { findMissingSection, validateScenariosYaml, parseFalsifiedClaims, parseFindingRow };
