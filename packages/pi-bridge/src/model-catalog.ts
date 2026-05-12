import {
  getModels,
  getProviders,
  getSupportedThinkingLevels,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
  DEFAULT_PHASE_MODELS,
  THINKING_LEVELS,
  type ModelCatalog,
  type ModelCatalogModel,
  type ModelCatalogProvider,
  type ThinkingLevel,
} from "@pi-harness/shared";
import {
  CROFAI_MODELS,
  CROFAI_PROVIDER_CONFIG,
  CROFAI_PROVIDER_NAME,
} from "./providers/crofai.js";

export function getModelCatalog(): ModelCatalog {
  return {
    providers: [...builtInProviders(), crofaiProvider()].filter(hasModels),
    defaults: DEFAULT_PHASE_MODELS,
  };
}

export function modelCatalogContains(
  catalog: ModelCatalog,
  providerId: string,
  modelId: string,
): boolean {
  const provider = catalog.providers.find((p) => p.id === providerId);
  return provider?.models.some((m) => m.id === modelId) ?? false;
}

function builtInProviders(): ModelCatalogProvider[] {
  return getProviders().map((provider) => ({
    id: provider,
    name: providerName(provider),
    models: getModels(provider).filter(isTextModel).map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      thinkingLevels: getSupportedThinkingLevels(model).filter(isThinkingLevel),
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      },
    })),
  }));
}

function crofaiProvider(): ModelCatalogProvider {
  return {
    id: CROFAI_PROVIDER_NAME,
    name: CROFAI_PROVIDER_CONFIG.name ?? "CrofAI",
    models: CROFAI_MODELS.filter(isTextModel).map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      thinkingLevels: model.reasoning ? THINKING_LEVELS : ["off"],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: {
        input: model.cost.input,
        output: model.cost.output,
        cacheRead: model.cost.cacheRead,
        cacheWrite: model.cost.cacheWrite,
      },
    })),
  };
}

function isTextModel(model: { readonly input: ReadonlyArray<string> }): boolean {
  return model.input.includes("text");
}

function hasModels(provider: ModelCatalogProvider): boolean {
  return provider.models.length > 0;
}

function isThinkingLevel(level: ModelThinkingLevel): level is ThinkingLevel {
  return THINKING_LEVELS.some((candidate) => candidate === level);
}

function providerName(provider: string): string {
  return provider
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
