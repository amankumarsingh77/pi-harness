import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import {
  BlastRadiusFileSchema,
  type Artifact,
  type PhaseModelConfig,
} from "@pi-harness/shared";
import { PREFLIGHT_SUBAGENTS, getSubagent } from "@pi-harness/subagents";
import { makeWriteFindingsTool } from "./write-findings-tool.js";
import { SUBAGENT_FOOTER } from "./subagent-footer.js";
import { buildTicketDigest } from "./ticket-digest.js";
import { ArtifactsStore } from "./artifacts-store.js";

export { PREFLIGHT_SUBAGENTS };
export type PreflightSubagent = string;

export const PREFLIGHT_SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;
const SCOUT_SUBAGENT = "codebase-scout";

export type CreateAgentSessionFn = (opts: AgentSessionOptions) => Promise<AgentSession>;

export type PreflightSubagentEvent =
  | {
      kind: "started";
      subagent: PreflightSubagent;
      sessionId: string;
    }
  | {
      kind: "ended";
      subagent: PreflightSubagent;
      sessionId: string;
      ok: boolean;
      durationMs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      error?: string;
    };

export type PreflightOpts = {
  cwd: string;
  taskId: string;
  ticketTitle: string;
  ticketDescription: string;
  designBody: string;
  specBody: string;
  phaseModel: PhaseModelConfig;
  createAgentSession: CreateAgentSessionFn;
  // Lifecycle hook for plan_subagent_started / _ended events. The orchestrator
  // wires this to PlanEventBus.publish in Phase 4; tests stub it to assert
  // ordering and payloads.
  onSubagentEvent: (e: PreflightSubagentEvent) => void | Promise<void>;
  // Forward of pi-bridge events from each subagent's session. The orchestrator
  // wires this to plan-event-bus so subagent message_delta / tool_call /
  // tool_result events surface in the existing Agent Log on /tasks/[id].
  onSubagentBridgeEvent?: (subagent: PreflightSubagent, e: PiBridgeEvent) => void;
  signal?: AbortSignal;
  subagentTimeoutMs?: number;
};

export type PreflightSubagentResult = {
  subagent: PreflightSubagent;
  ok: boolean;
  cancelled?: boolean;
  error?: string;
  findingsPath: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export type PreflightResult = {
  results: PreflightSubagentResult[];
  // True when any required subagent failed. The caller treats this as
  // "preflight failed" and fails the phase into plan_failed.
  failed: boolean;
  cancelled?: boolean;
};

// Dispatches plan preflight in two stages: first codebase-scout, then a
// deterministic blast-radius synthesis, then the remaining research agents in
// parallel. Findings files and blast-radius.yaml are the recovery anchors.
//
// Returns once every dispatched subagent has resolved (success or failure).
// The caller treats any missing required findings file as fatal. A subagent
// only succeeds when its session ends and a non-empty findings file exists.
export async function runPreflight(opts: PreflightOpts): Promise<PreflightResult> {
  const researchDir = join(opts.cwd, ".harness", opts.taskId, "research");
  await mkdir(researchDir, { recursive: true });

  const scoutResult = await runSubagentWithEvents({
    subagent: SCOUT_SUBAGENT,
    opts,
    researchDir,
  });

  if (!scoutResult.ok) {
    return {
      results: [scoutResult],
      failed: true,
      ...(scoutResult.cancelled === true ? { cancelled: true } : {}),
    };
  }

  await ensureBlastRadiusArtifact({ opts, researchDir });

  const enrichmentSubagents = PREFLIGHT_SUBAGENTS.filter((sa) => sa !== SCOUT_SUBAGENT);
  const tasks = enrichmentSubagents.map((subagent) =>
    runSubagentWithEvents({ subagent, opts, researchDir }),
  );

  const results = [scoutResult, ...(await Promise.all(tasks))];
  const failedCount = results.filter((r) => !r.ok).length;
  const cancelled = results.some((r) => r.cancelled === true);
  return {
    results,
    failed: failedCount > 0,
    ...(cancelled ? { cancelled: true } : {}),
  };
}

async function runSubagentWithEvents(args: {
  subagent: PreflightSubagent;
  opts: PreflightOpts;
  researchDir: string;
}): Promise<PreflightSubagentResult> {
  const { subagent, opts, researchDir } = args;
  const findingsPath = join(researchDir, `${subagent}.md`);
  // Cache hit: a previous tick already wrote this subagent's findings.
  // Skip silently — emit no started/ended events so the dashboard's
  // strip doesn't double-count.
  if (hasNonEmptyFindings(findingsPath)) {
    return {
      subagent,
      ok: true,
      findingsPath,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
    };
  }

  const sessionId = `psa_${randomUUID()}`;
  const startedAt = Date.now();
  await opts.onSubagentEvent({ kind: "started", subagent, sessionId });

  let result: PreflightSubagentResult;
  try {
    const usage = await runOneSubagent({ subagent, opts, findingsPath });
    result = {
      subagent,
      ok: true,
      findingsPath,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message = (err as Error).message;
    const cancelled = opts.signal?.aborted || message === "aborted";
    result = {
      subagent,
      ok: false,
      ...(cancelled ? { cancelled: true } : {}),
      error: message,
      findingsPath,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  await opts.onSubagentEvent({
    kind: "ended",
    subagent,
    sessionId,
    ok: result.ok,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    ...(result.error !== undefined ? { error: result.error } : {}),
  });

  return result;
}

async function runOneSubagent(args: {
  subagent: PreflightSubagent;
  opts: PreflightOpts;
  findingsPath: string;
}): Promise<{ costUsd: number; inputTokens: number; outputTokens: number }> {
  const { subagent, opts, findingsPath } = args;
  const def = getSubagent(subagent);
  const systemPrompt = `${readFileSync(def.promptPath, "utf8")}\n\n${SUBAGENT_FOOTER}\n`;
  const userPrompt = buildSubagentPrompt({ subagent, opts, findingsPath });

  let session: AgentSession;
  try {
    session = await opts.createAgentSession({
      cwd: opts.cwd,
      model: { provider: opts.phaseModel.provider, model: opts.phaseModel.model },
      ...(opts.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: opts.phaseModel.thinkingLevel }
        : {}),
      systemPrompt,
      tools: [...def.allowedTools],
      customTools: [
        makeWriteFindingsTool({ cwd: opts.cwd, taskId: opts.taskId, subagent }),
      ],
      onEvent: (e) => opts.onSubagentBridgeEvent?.(subagent, e),
    });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw err;
  }

  const timeoutMs = opts.subagentTimeoutMs ?? PREFLIGHT_SUBAGENT_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let promptPromise: Promise<{ costUsd: number; inputTokens: number; outputTokens: number }> | undefined;
  const onAbort = (): void => {
    void session.abort().catch(() => {});
  };

  try {
    if (opts.signal?.aborted) {
      await session.abort().catch(() => {});
      throw new Error(`preflight subagent ${subagent} aborted`);
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void session.abort().catch(() => {});
        reject(new Error(`preflight subagent ${subagent} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    promptPromise = session.prompt(userPrompt);
    const usage = await Promise.race([promptPromise, timeoutPromise]);
    if (!hasNonEmptyFindings(findingsPath)) {
      throw new Error(`preflight subagent ${subagent} completed without writing findings`);
    }
    return usage;
  } finally {
    if (timeout) clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onAbort);
    void promptPromise?.catch(() => {});
    await session.close().catch(() => {});
  }
}

function hasNonEmptyFindings(path: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").trim().length > 0;
}

function buildSubagentPrompt(args: {
  subagent: PreflightSubagent;
  opts: PreflightOpts;
  findingsPath: string;
}): string {
  const { subagent, opts } = args;
  const digest = buildTicketDigest({
    ticketTitle: opts.ticketTitle,
    ticketDescription: opts.ticketDescription,
    designBody: opts.designBody,
    specBody: opts.specBody,
  });
  const blastRadius = subagent === SCOUT_SUBAGENT
    ? null
    : readBlastRadiusBody(opts.cwd, opts.taskId);
  const blastRadiusSection = blastRadius
    ? [``, `# Current blast-radius.yaml`, ``, blastRadius]
    : [];
  return [
    `You are running inside a git worktree at ${opts.cwd}.`,
    ``,
    digest,
    ...blastRadiusSection,
    ``,
    `# Your job`,
    ``,
    getSubagent(subagent).framing,
    ``,
    `# Output discipline`,
    ``,
    `- Findings ≤ 4KB.`,
    `- File:line refs and short prose.`,
    `- No code blocks longer than 3 lines. Don't quote whole functions.`,
    ``,
    `Persist your findings via the \`write_findings\` tool. Call it exactly once when done.`,
  ].join("\n");
}

async function ensureBlastRadiusArtifact(args: {
  opts: PreflightOpts;
  researchDir: string;
}): Promise<void> {
  const { opts, researchDir } = args;
  const store = new ArtifactsStore();
  const existing = await store.readArtifact(opts.cwd, opts.taskId, "blast-radius");
  if (existing && isValidBlastRadiusBody(existing.body)) return;

  const scoutPath = join(researchDir, `${SCOUT_SUBAGENT}.md`);
  const scoutBody = existsSync(scoutPath) ? readFileSync(scoutPath, "utf8") : "";
  const body = buildBlastRadiusBody({
    taskId: opts.taskId,
    designBody: opts.designBody,
    specBody: opts.specBody,
    scoutBody,
  });
  const now = new Date().toISOString();
  const fallback: Artifact = {
    fm: {
      task: opts.taskId,
      kind: "blast-radius",
      parent: "spec.md",
      status: "draft",
      branch: `pi/${opts.taskId}`,
      last_updated: now,
      last_updated_by: "orchestrator",
    },
    body,
  };
  await store.writeArtifact(opts.cwd, opts.taskId, {
    fm: {
      ...(existing?.fm ?? fallback.fm),
      status: "draft",
      last_updated: now,
      last_updated_by: "orchestrator",
    },
    body,
  });
}

function isValidBlastRadiusBody(body: string): boolean {
  try {
    return BlastRadiusFileSchema.safeParse(yaml.load(body)).success;
  } catch {
    return false;
  }
}

function buildBlastRadiusBody(args: {
  taskId: string;
  designBody: string;
  specBody: string;
  scoutBody: string;
}): string {
  const requirementRefs = extractRequirementRefs(`${args.specBody}\n${args.designBody}`);
  const touchpoints = extractTouchpoints(args.scoutBody, args.taskId);
  const items = requirementRefs.map((ref, index) => ({
    id: `BR-${String(index + 1).padStart(3, "0")}`,
    requirementRefs: [ref],
    surface: inferSurface(touchpoints.map((t) => t.path)),
    title: `Impact area for ${ref}`,
    risk: "medium",
    touchpoints,
    inbound: [],
    outbound: [],
    precedentRefs: [],
    verificationRefs: [],
  }));
  return yaml.dump({ items }, { lineWidth: 100, sortKeys: false });
}

function extractRequirementRefs(body: string): string[] {
  const refs = [...body.matchAll(/\bREQ-\d+\b/g)].map((m) => m[0]);
  const unique = [...new Set(refs)];
  return unique.length > 0 ? unique.slice(0, 8) : ["REQ-001"];
}

function extractTouchpoints(
  scoutBody: string,
  taskId: string,
): Array<{ path: string; role: "change"; note: string }> {
  const backtickRefs = [...scoutBody.matchAll(/`([^`\n]+?\.[A-Za-z0-9]+(?::\d+)?)`/g)]
    .map((m) => normalizePathRef(m[1] ?? ""));
  const bulletRefs = [...scoutBody.matchAll(/^\s*-\s+([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?::\d+)?/gm)]
    .map((m) => normalizePathRef(m[1] ?? ""));
  const paths = [...new Set([...backtickRefs, ...bulletRefs].filter((p) => p.length > 0))];
  const selected = paths.slice(0, 8);
  const fallback = [`.harness/${taskId}/spec.md`];
  return (selected.length > 0 ? selected : fallback).map((path) => ({
    path,
    role: "change" as const,
    note: "Seeded from codebase-scout findings; planner and follow-up research should verify the exact impact.",
  }));
}

function normalizePathRef(ref: string): string {
  return ref.replace(/:\d+$/, "").trim();
}

function inferSurface(paths: string[]): "api" | "ui" | "db" | "worker" | "config" | "test" | "external" {
  if (paths.some((p) => p.includes("/dashboard/"))) return "ui";
  if (paths.some((p) => p.includes("/db/") || p.includes("schema"))) return "db";
  if (paths.some((p) => p.includes("/test/") || p.endsWith(".test.ts"))) return "test";
  if (paths.some((p) => p.includes("runner") || p.includes("worker"))) return "worker";
  if (paths.some((p) => p.endsWith(".json") || p.endsWith(".yaml") || p.endsWith(".toml"))) {
    return "config";
  }
  if (paths.some((p) => p.includes("/http/") || p.includes("/routes/"))) return "api";
  return "api";
}

function readBlastRadiusBody(cwd: string, taskId: string): string | null {
  const path = join(cwd, ".harness", taskId, "blast-radius.yaml");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}
