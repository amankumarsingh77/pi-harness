import { describe, expect, it } from "vitest";
import {
  CROFAI_API_KEY_ENV,
  CROFAI_BASE_URL,
  CROFAI_PROVIDER_CONFIG,
  CROFAI_PROVIDER_NAME,
} from "./crofai.js";

describe("CROFAI_PROVIDER_CONFIG", () => {
  it("declares the OpenAI-compatible endpoint", () => {
    expect(CROFAI_PROVIDER_NAME).toBe("crofai");
    expect(CROFAI_API_KEY_ENV).toBe("CROFAI_API_KEY");
    expect(CROFAI_BASE_URL).toBe("https://crof.ai/v1");
    expect(CROFAI_PROVIDER_CONFIG.baseUrl).toBe(CROFAI_BASE_URL);
    expect(CROFAI_PROVIDER_CONFIG.api).toBe("openai-completions");
  });

  it("registers at least one model and includes the kimi-k2.6 default", () => {
    const models = CROFAI_PROVIDER_CONFIG.models ?? [];
    expect(models.length).toBeGreaterThan(0);
    const ids = models.map((m: { id: string }) => m.id);
    expect(ids).toContain("kimi-k2.6");
  });

  it("each model has the required cost/window fields", () => {
    for (const m of CROFAI_PROVIDER_CONFIG.models ?? []) {
      expect(m.id.length).toBeGreaterThan(0);
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.reasoning).toBe("boolean");
      expect(m.input).toContain("text");
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxTokens).toBeGreaterThan(0);
      expect(m.cost.input).toBeGreaterThanOrEqual(0);
      expect(m.cost.output).toBeGreaterThanOrEqual(0);
    }
  });
});
