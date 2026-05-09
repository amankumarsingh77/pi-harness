import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { PiSession, PiBridgeEvent } from "@pi-harness/pi-bridge";
import type { PlanArtifact } from "@pi-harness/shared";

const SYSTEM_PATH = resolve(import.meta.dirname ?? __dirname, "prompts", "code.md");

const CoderResultSchema = z.object({
  branch: z.string().min(1),
  commits: z.array(z.string()),
  filesChanged: z.array(z.string()),
});
export type CoderEmitted = z.infer<typeof CoderResultSchema>;

export type CodeOpts = {
  taskId: string;
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  readPlan: (taskId: string) => Promise<PlanArtifact>;
  // If present, this is a verifier-failure-driven retry; gets pasted as a
  // follow-up turn so the coder fixes only the failing scope.
  retryHint?: { scenarioId: string; expected: string; actual: string };
};

export type CodeResult = {
  ok: boolean;
  branch?: string;
  commits?: string[];
  filesChanged?: string[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

export async function runCode(opts: CodeOpts): Promise<CodeResult> {
  const plan = await opts.readPlan(opts.taskId);
  const systemPrompt = await readFile(SYSTEM_PATH, "utf8");
  const session = await opts.createSession({
    cwd: opts.cwd,
    systemPrompt,
    onEvent: opts.onEvent,
  });

  try {
    const userMessage = opts.retryHint
      ? buildRetryMessage(opts.retryHint)
      : buildInitialMessage(plan);

    const result = await session.prompt(userMessage);

    if (result.finalText.includes("<coder-blocked>")) {
      const reason = result.finalText.split("<coder-blocked>")[1]?.trim().split("\n")[0];
      return {
        ok: false,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: `coder blocked: ${reason ?? "no reason given"}`,
      };
    }

    const parsed = parseCoderJson(result.finalText);
    if (!parsed.ok) {
      return {
        ok: false,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        error: parsed.error,
      };
    }
    return {
      ok: true,
      branch: parsed.value.branch,
      commits: parsed.value.commits,
      filesChanged: parsed.value.filesChanged,
      costUsd: result.costUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } finally {
    await session.close();
  }
}

function buildInitialMessage(plan: PlanArtifact): string {
  return `## Plan\n\n${JSON.stringify(plan, null, 2)}\n\n## Instruction\n\nImplement every step. TDD per step. One commit per step. Emit <coder-complete> + JSON when done.`;
}

function buildRetryMessage(hint: { scenarioId: string; expected: string; actual: string }): string {
  return [
    `## Verification failure`,
    ``,
    `Scenario: \`${hint.scenarioId}\``,
    `Expected: ${hint.expected}`,
    `Actual:   ${hint.actual}`,
    ``,
    `Fix only the failing scope. Re-emit <coder-complete> + JSON.`,
  ].join("\n");
}

function parseCoderJson(text: string): { ok: true; value: CoderEmitted } | { ok: false; error: string } {
  const sentinel = text.indexOf("<coder-complete>");
  if (sentinel === -1) return { ok: false, error: "missing <coder-complete> sentinel" };
  const m = text.slice(sentinel).match(/```json\s*([\s\S]+?)\s*```/);
  if (!m) return { ok: false, error: "missing ```json block" };
  try {
    return { ok: true, value: CoderResultSchema.parse(JSON.parse(m[1]!)) };
  } catch (e) {
    return { ok: false, error: `parse error: ${(e as Error).message}` };
  }
}
