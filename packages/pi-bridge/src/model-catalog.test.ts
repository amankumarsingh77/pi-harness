import { describe, expect, it } from "vitest";
import { getModels, getProviders } from "@earendil-works/pi-ai";
import { DEFAULT_PHASE_MODELS, PHASES, THINKING_LEVELS } from "@pi-harness/shared";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CROFAI_PROVIDER_NAME } from "./providers/crofai.js";
import {
  getModelCatalog,
  modelCatalogContains,
  modelCatalogFromRegistry,
  registerCrofaiFallbackIfAbsent,
} from "./model-catalog.js";

describe("getModelCatalog", () => {
  it("includes built-in pi-ai providers and CrofAI", () => {
    const catalog = getModelCatalog();
    const providerIds = catalog.providers.map((provider) => provider.id);

    expect(providerIds).toContain(CROFAI_PROVIDER_NAME);
    expect(providerIds).toContain(getProviders()[0]);
  });

  it("contains every default phase provider/model", () => {
    const catalog = getModelCatalog();

    for (const phase of PHASES) {
      const model = DEFAULT_PHASE_MODELS[phase];
      expect(modelCatalogContains(catalog, model.provider, model.model), phase).toBe(true);
    }
  });

  it("keeps only text-capable built-in models", () => {
    const catalog = getModelCatalog();

    for (const provider of getProviders()) {
      const sourceModels = getModels(provider);
      const catalogProvider = catalog.providers.find((p) => p.id === provider);
      if (!catalogProvider) continue;

      for (const model of catalogProvider.models) {
        const source = sourceModels.find((m) => m.id === model.id);
        expect(source?.input).toContain("text");
      }
    }
  });

  it("reports supported thinking levels for each catalog model", () => {
    const catalog = getModelCatalog();

    for (const provider of catalog.providers) {
      for (const model of provider.models) {
        expect(model.thinkingLevels.length).toBeGreaterThan(0);
        for (const level of model.thinkingLevels) {
          expect(THINKING_LEVELS).toContain(level);
        }
      }
    }
  });

  it("includes custom providers from a ModelRegistry without leaking credentials", () => {
    const auth = AuthStorage.inMemory({
      "custom-provider": { type: "api_key", key: "sk-secret-never-serialize" },
    });
    const registry = ModelRegistry.inMemory(auth);
    registry.registerProvider("custom-provider", {
      name: "Custom Provider",
      baseUrl: "https://example.test/v1",
      apiKey: "CUSTOM_PROVIDER_API_KEY",
      api: "openai-completions",
      models: [
        {
          id: "custom-model",
          name: "Custom Model",
          reasoning: false,
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 1000,
        },
      ],
    });

    const catalog = modelCatalogFromRegistry(registry);

    expect(modelCatalogContains(catalog, "custom-provider", "custom-model")).toBe(true);
    expect(catalog.providers.find((provider) => provider.id === "custom-provider")).toMatchObject({
      authStatus: { configured: true, source: "stored" },
    });
    expect(JSON.stringify(catalog)).not.toContain("sk-secret-never-serialize");
  });

  it("does not replace a custom CrofAI provider with the repo fallback", () => {
    const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
    registry.registerProvider(CROFAI_PROVIDER_NAME, {
      name: "Custom CrofAI",
      baseUrl: "https://example.test/v1",
      apiKey: "CROFAI_API_KEY",
      api: "openai-completions",
      models: [
        {
          id: "custom-crofai-model",
          name: "Custom CrofAI Model",
          reasoning: true,
          input: ["text"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1000,
          maxTokens: 1000,
        },
      ],
    });

    registerCrofaiFallbackIfAbsent(registry);
    const catalog = modelCatalogFromRegistry(registry);

    expect(modelCatalogContains(catalog, CROFAI_PROVIDER_NAME, "custom-crofai-model")).toBe(true);
    expect(modelCatalogContains(catalog, CROFAI_PROVIDER_NAME, "kimi-k2.6")).toBe(false);
  });
});
