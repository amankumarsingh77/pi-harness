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

export const PREFLIGHT_SUBAGENT_MAX_TURNS = 12;
export const PREFLIGHT_SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;

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
// The caller treats any missing required findings file as fatal. A subagent
// only succeeds when its session ends and a non-empty findings file exists.
export async function runPreflight(opts: PreflightOpts): Promise<PreflightResult> {
  const researchDir = join(opts.cwd, ".harness", opts.taskId, "research");
  await mkdir(researchDir, { recursive: true });

  const tasks = PREFLIGHT_SUBAGENTS.map(async (subagent) => {
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
  return { results, failed: failedCount > 0 };
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
      maxTurns: PREFLIGHT_SUBAGENT_MAX_TURNS,
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
