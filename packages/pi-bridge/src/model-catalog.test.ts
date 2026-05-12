import { describe, expect, it } from "vitest";
import { getModels, getProviders } from "@earendil-works/pi-ai";
import { DEFAULT_PHASE_MODELS, PHASES, THINKING_LEVELS } from "@pi-harness/shared";
import { CROFAI_PROVIDER_NAME } from "./providers/crofai.js";
import { getModelCatalog, modelCatalogContains } from "./model-catalog.js";

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
});
