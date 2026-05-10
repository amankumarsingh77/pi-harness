import type { Phase } from "../types/run.js";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type PhaseModelConfig = {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  maxTurns: number;
};

// Code-level defaults. Edits require a deploy. Per-task overrides go through
// the tasks.phase_models JSONB column and merge into these via mergePhaseModels.
// All phases use opencode-go + kimi-k2.6 today. Single provider keeps auth
// surface to one env key (OPENCODE_API_KEY); model id is from pi-ai's
// generated registry (`kimi-k2.6` under provider `opencode-go`).
export const DEFAULT_PHASE_MODELS: Record<Phase, PhaseModelConfig> = {
  brainstorm: { provider: "opencode-go", model: "kimi-k2.6", thinkingLevel: "medium", maxTurns: 30 },
  plan:       { provider: "opencode-go", model: "kimi-k2.6", thinkingLevel: "high",   maxTurns: 20 },
  code:       { provider: "opencode-go", model: "kimi-k2.6", thinkingLevel: "medium", maxTurns: 80 },
  verify:     { provider: "opencode-go", model: "kimi-k2.6", thinkingLevel: "high",   maxTurns: 30 },
  pr:         { provider: "opencode-go", model: "kimi-k2.6", thinkingLevel: "off",    maxTurns: 5  },
};

export function mergePhaseModels(
  overrides: Partial<Record<Phase, Partial<PhaseModelConfig>>>,
  phase: Phase,
): PhaseModelConfig {
  return { ...DEFAULT_PHASE_MODELS[phase], ...(overrides[phase] ?? {}) };
}
