import {
  AuthStorage,
  ModelRegistry,
  type AuthStatus,
} from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
  DEFAULT_PHASE_MODELS,
  PHASES,
  THINKING_LEVELS,
  type ModelAuthStatus,
  type ModelCatalog,
  type ModelCatalogModel,
  type ModelCatalogProvider,
  type ThinkingLevel,
} from "@pi-harness/shared";
import { CROFAI_PROVIDER_CONFIG, CROFAI_PROVIDER_NAME } from "./providers/crofai.js";

const crofaiFallbackRegistries = new WeakSet<ModelRegistry>();

export function getModelCatalog(): ModelCatalog {
  return modelCatalogFromRegistry(createHarnessModelRegistry());
}

export function createHarnessModelRegistry(
  authStorage: AuthStorage = AuthStorage.create(),
): ModelRegistry {
  const registry = ModelRegistry.create(authStorage);
  registerCrofaiFallbackIfAbsent(registry);
  return registry;
}

export function registerCrofaiFallbackIfAbsent(registry: ModelRegistry): void {
  const hasCrofai = registry.getAll().some((model) => model.provider === CROFAI_PROVIDER_NAME);
  if (!hasCrofai) {
    registry.registerProvider(CROFAI_PROVIDER_NAME, CROFAI_PROVIDER_CONFIG);
    crofaiFallbackRegistries.add(registry);
  }
}

export function registryUsesCrofaiFallback(registry: ModelRegistry): boolean {
  return crofaiFallbackRegistries.has(registry);
}

export function modelCatalogFromRegistry(registry: ModelRegistry): ModelCatalog {
  return {
    phases: PHASES,
    thinkingLevels: THINKING_LEVELS,
    providers: groupProviders(registry).filter((provider) => provider.models.length > 0),
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

export function modelCatalogSupportsThinkingLevel(
  catalog: ModelCatalog,
  providerId: string,
  modelId: string,
  thinkingLevel: ThinkingLevel,
): boolean {
  const provider = catalog.providers.find((p) => p.id === providerId);
  const model = provider?.models.find((m) => m.id === modelId);
  return model?.thinkingLevels.includes(thinkingLevel) ?? false;
}

function groupProviders(registry: ModelRegistry): ModelCatalogProvider[] {
  const grouped = new Map<string, Model<Api>[]>();
  for (const model of registry.getAll().filter(isTextModel)) {
    grouped.set(model.provider, [...(grouped.get(model.provider) ?? []), model]);
  }
  return [...grouped.entries()]
    .map(([providerId, models]) => ({
      id: providerId,
      name: registry.getProviderDisplayName(providerId),
      authStatus: safeAuthStatus(registry.getProviderAuthStatus(providerId)),
      models: models.map(catalogModel),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function catalogModel(model: Model<Api>): ModelCatalogModel {
  return {
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
  };
}

function safeAuthStatus(status: AuthStatus): ModelAuthStatus {
  return {
    configured: status.configured,
    ...(status.source !== undefined ? { source: status.source } : {}),
    ...(status.label !== undefined ? { label: status.label } : {}),
  };
}

function isTextModel(model: Model<Api>): boolean {
  return model.input.includes("text");
}

function isThinkingLevel(level: ModelThinkingLevel): level is ThinkingLevel {
  return THINKING_LEVELS.some((candidate) => candidate === level);
}
