import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PiSession, PiBridgeEvent, PiSubagentResult, PiSubagentSpec } from "@pi-harness/pi-bridge";
import { PlanArtifactSchema, type PlanArtifact } from "@pi-harness/shared";
import type { LegacyRunArtifactsStore } from "./artifacts-store.js";
import type { FanoutResult } from "./plan-fanout.js";

const SYSTEM_PATH = resolve(import.meta.dirname ?? __dirname, "prompts", "plan.md");

type RunSubagent = (spec: PiSubagentSpec) => Promise<PiSubagentResult>;
type Fanout = (opts: {
  cwd: string;
  task: string;
  runSubagent: RunSubagent;
}) => Promise<FanoutResult>;

export type PlanOpts = {
  taskId: string;
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  runSubagent: RunSubagent;
  fanoutResearch: Fanout;
  store: LegacyRunArtifactsStore;
};

export type PlanResult = {
  ok: boolean;
  artifact?: PlanArtifact;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error?: string;
};

export async function runPlan(opts: PlanOpts): Promise<PlanResult> {
  const brainstorm = await opts.store.readBrainstorm(opts.taskId);

  // Phase 2–3 of §7.1: parallel research fanout.
  const research = await opts.fanoutResearch({
    cwd: opts.cwd,
    task: brainstorm.goal,
    runSubagent: opts.runSubagent,
  });

  // Phase 4: synthesis. The planner LLM gets brainstorm + all research findings
  // in its user message; the system prompt is plan.md.
  const systemPrompt = await readFile(SYSTEM_PATH, "utf8");
  const session = await opts.createSession({
    cwd: opts.cwd,
    systemPrompt,
    onEvent: opts.onEvent,
  });

  try {
    const userMessage = buildPlannerInput(brainstorm, research);
    const result = await session.prompt(userMessage);

    const parsed = parseFinalPlan(result.finalText);
    if (!parsed.ok) {
      return {
        ok: false,
        totalCostUsd: research.totalCostUsd + result.costUsd,
        totalInputTokens: research.totalInputTokens + result.inputTokens,
        totalOutputTokens: research.totalOutputTokens + result.outputTokens,
        error: parsed.error,
      };
    }
    await opts.store.writePlan(opts.taskId, parsed.artifact);
    return {
      ok: true,
      artifact: parsed.artifact,
      totalCostUsd: research.totalCostUsd + result.costUsd,
      totalInputTokens: research.totalInputTokens + result.inputTokens,
      totalOutputTokens: research.totalOutputTokens + result.outputTokens,
    };
  } finally {
    await session.close();
  }
}

function buildPlannerInput(
  brainstorm: { goal: string; decisions: string[] },
  research: FanoutResult,
): string {
  const lines: string[] = [];
  lines.push("## Brainstorm");
  lines.push(`Goal: ${brainstorm.goal}`);
  if (brainstorm.decisions.length) {
    lines.push("Decisions:");
    for (const d of brainstorm.decisions) lines.push(`- ${d}`);
  }
  lines.push("");
  lines.push("## Research findings");
  for (const [agent, finding] of Object.entries(research.findings)) {
    lines.push(`### ${agent}`);
    if (!finding.ok) {
      lines.push(`(failed: ${finding.error ?? "unknown"})`);
    } else {
      lines.push(finding.output);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function parseFinalPlan(
  text: string,
): { ok: true; artifact: PlanArtifact } | { ok: false; error: string } {
  const sentinel = text.indexOf("<plan-complete>");
  if (sentinel === -1) return { ok: false, error: "missing <plan-complete> sentinel" };
  const after = text.slice(sentinel);
  const m = after.match(/```json\s*([\s\S]+?)\s*```/);
  if (!m) return { ok: false, error: "missing ```json block" };
  try {
    return { ok: true, artifact: PlanArtifactSchema.parse(JSON.parse(m[1]!)) as PlanArtifact };
  } catch (e) {
    return { ok: false, error: `parse error: ${(e as Error).message}` };
  }
}
