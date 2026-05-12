import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { AuthError } from "@pi-harness/pi-bridge";
import type { PhaseModelConfig } from "@pi-harness/shared";
import { PREFLIGHT_SUBAGENTS, getSubagent } from "@pi-harness/subagents";
import { makeWriteFindingsTool } from "./write-findings-tool.js";
import { SUBAGENT_FOOTER } from "./subagent-footer.js";
import { buildTicketDigest } from "./ticket-digest.js";

export { PREFLIGHT_SUBAGENTS };
export type PreflightSubagent = string;

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
// reports `failed: true` only when a majority of subagents failed.
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
  return { results, failed: failedCount > results.length / 2 };
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
      // The SDK's `tools` option is an absolute allowlist that filters custom
      // tools too — omit `write_findings` here and the model gets back
      // "Tool write_findings not found" on every call.
      tools: [...def.allowedTools, "write_findings"],
      customTools: [
        makeWriteFindingsTool({ cwd: opts.cwd, taskId: opts.taskId, subagent }),
      ],
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
  const { subagent, opts } = args;
  const digest = buildTicketDigest({
    ticketTitle: opts.ticketTitle,
    ticketDescription: opts.ticketDescription,
    designBody: opts.designBody,
    specBody: opts.specBody,
  });
  return [
    `You are running inside a git worktree at ${opts.cwd}.`,
    ``,
    digest,
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
