import type { PiSubagentSpec, PiSubagentResult } from "@pi-harness/pi-bridge";

// The five researchers we always dispatch (spec §7.1 phases 2a–3a, minus the
// optional peer-comparator). Adding `peer-comparator` is a fanout-time decision
// the planner makes after scope-tracer; this constant is the always-on set.
export const REQUIRED_RESEARCHERS = [
  "codebase-locator",
  "codebase-pattern-finder",
  "codebase-analyzer",
  "integration-scanner",
  "test-case-locator",
  "precedent-locator",
] as const;

export type Researcher = (typeof REQUIRED_RESEARCHERS)[number];

export type ResearchFinding = {
  ok: boolean;
  output: string;
  error?: string;
  costUsd: number;
};

export type FanoutResult = {
  findings: Record<string, ResearchFinding>;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
};

type RunSubagent = (spec: PiSubagentSpec) => Promise<PiSubagentResult>;

export async function fanoutResearch(opts: {
  cwd: string;
  task: string;
  runSubagent: RunSubagent;
}): Promise<FanoutResult> {
  const settled = await Promise.all(
    REQUIRED_RESEARCHERS.map(async (agent) => {
      const r = await opts.runSubagent({ agent, task: opts.task, cwd: opts.cwd });
      return { agent, r };
    }),
  );

  const findings: Record<string, ResearchFinding> = {};
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const { agent, r } of settled) {
    const finding: ResearchFinding = { ok: r.ok, output: r.output, costUsd: r.costUsd };
    if (r.error !== undefined) finding.error = r.error;
    findings[agent] = finding;
    totalCostUsd += r.costUsd;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
  }

  return { findings, totalCostUsd, totalInputTokens, totalOutputTokens };
}
