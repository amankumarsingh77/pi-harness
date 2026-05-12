import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

// ProviderConfigInput isn't re-exported from the package root; pull the type
// off ModelRegistry.registerProvider's signature so we don't depend on the
// internal `dist/core/model-registry` path.
type ProviderConfigInput = Parameters<ModelRegistry["registerProvider"]>[1];
type CrofaiModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
};

export const CROFAI_PROVIDER_NAME = "crofai";
export const CROFAI_API_KEY_ENV = "CROFAI_API_KEY";
export const CROFAI_BASE_URL = "https://crof.ai/v1";
export const CROFAI_MODELS: CrofaiModel[] = [
  {
    id: "kimi-k2.6",
    name: "MoonshotAI: Kimi K2.6",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.5, output: 1.99, cacheRead: 0.1, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    id: "deepseek-v3.2",
    name: "DeepSeek: DeepSeek V3.2",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.28, output: 0.38, cacheRead: 0.06, cacheWrite: 0 },
    contextWindow: 163840,
    maxTokens: 163840,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek: DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.4, output: 0.85, cacheRead: 0.003, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 131_072,
  },
  {
    id: "glm-4.7",
    name: "Z.AI: GLM 4.7",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.25, output: 1.1, cacheRead: 0.05, cacheWrite: 0 },
    contextWindow: 202_752,
    maxTokens: 202_752,
  },
];

// Curated subset of https://crof.ai/v1/models. Costs are USD per 1M tokens
// (CrofAI publishes them as strings; we convert at definition time).
// Refresh by re-querying /v1/models when adding entries — keep this list small
// and only include models we'd actually route a phase to.
export const CROFAI_PROVIDER_CONFIG: ProviderConfigInput = {
  name: "CrofAI",
  baseUrl: CROFAI_BASE_URL,
  api: "openai-completions",
  // The SDK reads `apiKey` as an env-var name and pulls the value from
  // process.env at request time. Required by ModelRegistry's validator.
  apiKey: CROFAI_API_KEY_ENV,
  models: CROFAI_MODELS,
};
