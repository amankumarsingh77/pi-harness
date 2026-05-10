import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import type { PhaseModelConfig } from "@pi-harness/shared";

// agents/ → src/ → orchestrator/ → apps/ → repo root → subagents/_vendored/<name>.md
// Same import.meta.url anchor as brainstorm.ts. Ensures the .md prompts
// resolve in both src and dist runtimes since the layout depth matches.
const HERE = dirname(fileURLToPath(import.meta.url));
const VENDORED_DIR = resolvePath(HERE, "..", "..", "..", "..", "subagents", "_vendored");

// The five research subagents that run in parallel before the planner.
// claim-verifier is intentionally excluded — it runs from mark_ready (Phase 4),
// not from preflight, because it operates on the planner's draft plan.md.
//
// scope-tracer and test-case-locator were dropped: brainstorm already bounds
// scope (and gates on user approval), and test-case-locator searches the
// rpiv-mono `.rpiv/test-cases/` convention which doesn't exist here. Their
// vendored prompts remain on disk in subagents/_vendored/ for revivability.
export const PREFLIGHT_SUBAGENTS = [
  "codebase-locator",
  "codebase-pattern-finder",
  "codebase-analyzer",
  "integration-scanner",
  "precedent-locator",
] as const;
export type PreflightSubagent = (typeof PREFLIGHT_SUBAGENTS)[number];

// One-line task framing the planner-side prompt feeds to each subagent. The
// vendored system prompt does the heavy lifting; this just tells the agent
// what *this* ticket needs from it.
const FRAMINGS: Record<PreflightSubagent, string> = {
  "codebase-locator":
    "Locate every file that will be read or modified to deliver this ticket.",
  "codebase-pattern-finder":
    "Find existing patterns analogous to what this ticket asks for. Cite file:line references for each example.",
  "codebase-analyzer":
    "Trace how the relevant call paths (the touchpoints surfaced by codebase-locator) work today.",
  "integration-scanner":
    "Identify inbound and outbound system edges affected by this ticket.",
  "precedent-locator":
    "Find past similar changes from git history and what went wrong with each one.",
};

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
};

export type PreflightSubagentResult = {
  subagent: PreflightSubagent;
  ok: boolean;
  error?: string;
  findingsPath: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export type PreflightResult = {
  results: PreflightSubagentResult[];
  // True when ≥3 subagents failed. The caller (runPlan in Phase 4) treats
  // this as "preflight failed" and fails the phase into plan_failed.
  failed: boolean;
};

// Dispatches every research subagent whose findings file doesn't already
// exist. Each subagent runs in its own pi session (no shared session JSONL —
// they're one-shot), all in parallel. Findings files are the canonical
// recovery anchor: a re-entry after orchestrator crash skips any subagent
// whose file is already on disk.
//
// Returns once every dispatched subagent has resolved (success or failure).
// The caller decides whether the failure rate is fatal; preflight itself
// reports `failed: true` only when ≥3 subagents failed.
export async function runPreflight(opts: PreflightOpts): Promise<PreflightResult> {
  const researchDir = join(opts.cwd, ".harness", opts.taskId, "research");
  await mkdir(researchDir, { recursive: true });

  const tasks = PREFLIGHT_SUBAGENTS.map(async (subagent) => {
    const findingsPath = join(researchDir, `${subagent}.md`);
    // Cache hit: a previous tick already wrote this subagent's findings.
    // Skip silently — emit no started/ended events so the dashboard's
    // strip doesn't double-count.
    if (existsSync(findingsPath)) {
      return {
        subagent,
        ok: true,
        findingsPath,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
      } satisfies PreflightSubagentResult;
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
      result = {
        subagent,
        ok: false,
        error: (err as Error).message,
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
  });

  const results = await Promise.all(tasks);
  const failedCount = results.filter((r) => !r.ok).length;
  return { results, failed: failedCount >= 3 };
}

async function runOneSubagent(args: {
  subagent: PreflightSubagent;
  opts: PreflightOpts;
  findingsPath: string;
}): Promise<{ costUsd: number; inputTokens: number; outputTokens: number }> {
  const { subagent, opts, findingsPath } = args;
  const promptPath = join(VENDORED_DIR, `${subagent}.md`);
  const systemPrompt = readFileSync(promptPath, "utf8");
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
      onEvent: (e) => opts.onSubagentBridgeEvent?.(subagent, e),
    });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw err;
  }

  try {
    const usage = await session.prompt(userPrompt);
    return usage;
  } finally {
    await session.close().catch(() => {});
  }
}

function buildSubagentPrompt(args: {
  subagent: PreflightSubagent;
  opts: PreflightOpts;
  findingsPath: string;
}): string {
  const { subagent, opts, findingsPath } = args;
  const relFindings = findingsPath.startsWith(opts.cwd)
    ? findingsPath.slice(opts.cwd.length + 1)
    : findingsPath;
  return [
    `You are running inside a git worktree at ${opts.cwd}.`,
    ``,
    `# Ticket`,
    ``,
    `## ${opts.ticketTitle}`,
    ``,
    opts.ticketDescription,
    ``,
    `# Brainstorm artifacts`,
    ``,
    `The brainstorm phase produced two committed artifacts you must read first.`,
    ``,
    `## design.md`,
    ``,
    opts.designBody,
    ``,
    `## spec.md`,
    ``,
    opts.specBody,
    ``,
    `# Your job`,
    ``,
    FRAMINGS[subagent],
    ``,
    `Write your findings to \`${relFindings}\`. Keep them focused and citation-grounded per the guidelines in your system prompt.`,
  ].join("\n");
}
