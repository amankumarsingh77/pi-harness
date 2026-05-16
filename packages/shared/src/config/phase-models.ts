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

export type ModelAuthStatus = {
  readonly configured: boolean;
  readonly source?:
    | "stored"
    | "runtime"
    | "environment"
    | "fallback"
    | "models_json_key"
    | "models_json_command";
  readonly label?: string;
};

export type ModelCost = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

export type ModelCatalogModel = {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly thinkingLevels: ReadonlyArray<ThinkingLevel>;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost: ModelCost;
};

export type ModelCatalogProvider = {
  readonly id: string;
  readonly name: string;
  readonly authStatus: ModelAuthStatus;
  readonly models: ReadonlyArray<ModelCatalogModel>;
};

export type ModelCatalog = {
  readonly phases: ReadonlyArray<Phase>;
  readonly thinkingLevels: ReadonlyArray<ThinkingLevel>;
  readonly providers: ReadonlyArray<ModelCatalogProvider>;
  readonly defaults: Record<Phase, PhaseModelConfig>;
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
  // brainstorm: { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "medium" },
  // plan:       { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "medium"   },
  // code:       { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "medium" },
  // verify:     { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "high"   },
  // pr:         { provider: "openai-codex", model: "gpt-5.5", thinkingLevel: "off"    },
};

export function mergePhaseModels(
  overrides: Partial<Record<Phase, Partial<PhaseModelConfig>>>,
  phase: Phase,
): PhaseModelConfig {
  return { ...DEFAULT_PHASE_MODELS[phase], ...(overrides[phase] ?? {}) };
}
