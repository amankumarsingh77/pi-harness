import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import yaml from "js-yaml";
import { BlastRadiusFileSchema, ScenarioFileSchema, type Artifact } from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { PlanEventBus } from "./plan-event-bus.js";

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

export type MarkReadyDetails = { ok: boolean; missing?: string };

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
};

export type DispatchClaimVerifier = (planBody: string) => Promise<ClaimVerifierResult>;

export function makeMarkReadyTool(deps: {
  store: ArtifactsStore;
  bus: PlanEventBus;
  cwd: string;
  taskId: string;
  dispatchClaimVerifier: DispatchClaimVerifier;
  claimVerifierState: ClaimVerifierState;
}): ToolLike<typeof MarkReadyParams, MarkReadyDetails> {
  const { store, bus, cwd, taskId, dispatchClaimVerifier, claimVerifierState } = deps;

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

      // 2. Frontmatter status invariant: must be draft or ready.
      for (const [name, art] of [
        ["plan.md", plan],
        ["scenarios.yaml", scenarios],
        ["blast-radius.yaml", blastRadius],
      ] as const) {
        if (art.fm.status !== "draft" && art.fm.status !== "ready") {
          return reject(`${name} frontmatter status invalid (got: ${art.fm.status})`);
        }
      }

      // 3. plan.md required sections.
      const missingSection = findMissingSection(plan.body);
      if (missingSection) return reject(missingSection);

      // 4. scenarios.yaml schema.
      const scenariosError = validateScenariosYaml(scenarios.body);
      if (scenariosError) return reject(`scenarios.yaml: ${scenariosError}`);
      const blastRadiusError = validateBlastRadiusYaml(blastRadius.body);
      if (blastRadiusError) return reject(`blast-radius.yaml: ${blastRadiusError}`);

      // 5. claim-verifier gate. The vendored claim-verifier subagent reviews
      //    plan.md for unsupported claims; if any come back Falsified the
      //    planner must revise. Capped per run so a perpetual loop can't burn
      //    cost: after 2 attempts the phase fails into plan_failed.
      const claimsResult = await runClaimVerifier({
        cwd,
        taskId,
        planBody: plan.body,
        dispatchClaimVerifier,
        state: claimVerifierState,
      });
      if (claimsResult.kind === "exhausted") {
        return reject(claimsResult.message);
      }
      if (claimsResult.kind === "falsified") {
        return reject(
          `claim-verifier: ${claimsResult.claims[0]} — re-evaluate or remove (${claimsResult.claims.length} flagged)`,
        );
      }

      // Already-ready: skip the status flip but still terminate.
      const alreadyReady =
        plan.fm.status === "ready" &&
        scenarios.fm.status === "ready" &&
        blastRadius.fm.status === "ready";
      if (alreadyReady) {
        return {
          content: [{ type: "text", text: "ready" }],
          details: { ok: true },
          terminate: true,
        };
      }

      // 6. Flip both artifacts to ready, write back, publish status_changed.
      const now = new Date().toISOString();
      for (const cur of [plan, scenarios, blastRadius] as const) {
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

// Returns the first missing-section error string for plan.md, or null if all
// PLAN_REQUIRED_SECTIONS are present with non-empty bodies. Same body-empty
// rule as brainstorm-tools.findMissingSection: a section's body runs from
// after its heading line to the next "## " heading (or EOF) and must contain
// at least one non-whitespace character.
function findMissingSection(body: string): string | null {
  const lines = body.split("\n");
  for (const heading of PLAN_REQUIRED_SECTIONS) {
    const headingIdx = lines.findIndex((l) => l.trim() === heading);
    if (headingIdx === -1) {
      return `plan.md missing: ${heading}`;
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
      return `plan.md missing: ${heading} (empty)`;
    }
  }
  return null;
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

function validateYamlBody(body: string, schema: typeof ScenarioFileSchema | typeof BlastRadiusFileSchema): string | null {
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

type ClaimVerifierOutcome =
  | { kind: "ok" }
  | { kind: "falsified"; claims: string[] }
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
