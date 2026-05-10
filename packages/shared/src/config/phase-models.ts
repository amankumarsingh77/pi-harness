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
};

// Code-level defaults. Edits require a deploy. Per-task overrides go through
// the tasks.phase_models JSONB column and merge into these via mergePhaseModels.
// All phases use crofai + kimi-k2.6 — CrofAI is registered as a custom provider
// in pi-bridge (see packages/pi-bridge/src/providers/crofai.ts). Single provider
// keeps auth surface to one env key (CROFAI_API_KEY).
export const DEFAULT_PHASE_MODELS: Record<Phase, PhaseModelConfig> = {
  brainstorm: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "medium" },
  plan:       { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "high"   },
  code:       { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "medium" },
  verify:     { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "high"   },
  pr:         { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "off"    },
};

export function mergePhaseModels(
  overrides: Partial<Record<Phase, Partial<PhaseModelConfig>>>,
  phase: Phase,
): PhaseModelConfig {
  return { ...DEFAULT_PHASE_MODELS[phase], ...(overrides[phase] ?? {}) };
}
