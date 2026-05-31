import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { listProviders } from "./provider-registry.js";
import { loadEnvHarness } from "./auth.js";

// listProviders is the single enumeration backing the catalog endpoint and the
// model pickers. It walks pi-ai's built-in catalog plus our custom providers and
// flags each `authenticated` using the same credential resolution session
// creation uses. We assert the observable shape only.
//
// loadEnvHarness is primed once up front so subsequent listProviders() calls
// don't re-inject keys from .env.harness over our per-test env manipulation
// (dotenv only writes absent/empty keys, and the load is cached after first run).

const TOUCHED_ENV = ["ANTHROPIC_API_KEY", "CROFAI_API_KEY"] as const;

describe("listProviders", () => {
  let saved: Record<string, string | undefined>;

  beforeAll(() => {
    loadEnvHarness();
  });

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED_ENV.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const k of TOUCHED_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("includes built-in providers, the custom crofai provider, and reflects auth from env", () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key"; // present
    delete process.env["CROFAI_API_KEY"]; // absent
    const providers = listProviders();

    const ids = providers.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("crofai");

    const anthropic = providers.find((p) => p.id === "anthropic");
    expect(anthropic?.authenticated).toBe(true);
    expect(anthropic && anthropic.models.length > 0).toBe(true);
    // requiredEnvVars drives the "set X in .env.harness" hint.
    expect(anthropic?.requiredEnvVars).toContain("ANTHROPIC_API_KEY");

    const crofai = providers.find((p) => p.id === "crofai");
    expect(crofai?.authenticated).toBe(false);
    expect(crofai?.requiredEnvVars).toEqual(["CROFAI_API_KEY"]);
    expect(crofai?.models.map((m) => m.id)).toContain("kimi-k2.6");
    // The unified model shape carries both cost and maxTokens.
    const kimi = crofai?.models.find((m) => m.id === "kimi-k2.6");
    expect(kimi?.cost.input).toBeGreaterThan(0);
    expect(kimi?.maxTokens).toBeGreaterThan(0);
  });

  it("crofai authenticated when CROFAI_API_KEY is present", () => {
    process.env["CROFAI_API_KEY"] = "crofai-test-key";
    const providers = listProviders();
    expect(providers.find((p) => p.id === "crofai")?.authenticated).toBe(true);
  });

  it("openai-codex exposes its full catalog (no model filtering) and is oauth", () => {
    // ChatGPT-account eligibility is a runtime OpenAI policy with no reliable
    // static signal, so the catalog is surfaced as-is and rejected models fall
    // back to the chat.error notice.
    const codex = listProviders().find((p) => p.id === "openai-codex");
    expect(codex).toBeDefined();
    expect(codex?.auth).toBe("oauth");
    expect(codex?.requiredEnvVars).toEqual([]);
    const ids = codex?.models.map((m) => m.id) ?? [];
    expect(ids).toContain("gpt-5.5");
  });

  it("sorts authenticated providers first, then alphabetically", () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    delete process.env["CROFAI_API_KEY"];
    const providers = listProviders();
    const firstUnauthIdx = providers.findIndex((p) => !p.authenticated);
    const lastAuthIdx = providers.map((p) => p.authenticated).lastIndexOf(true);
    if (firstUnauthIdx !== -1 && lastAuthIdx !== -1) {
      expect(lastAuthIdx).toBeLessThan(firstUnauthIdx);
    }
  });
});
