/**
 * provider-registry.ts — the single source of truth for providers and models.
 *
 * Every component that needs the provider/model list (the HTTP catalog endpoint,
 * the chat model picker, the new-task stage selector) and every credential
 * decision in session creation (resolveModel, assertCredential, syncRuntimeApiKey,
 * the custom-provider registration) derives from this module. Nothing else may
 * enumerate `getProviders()`/`getModels()` or maintain its own provider→env-var
 * map; doing so reintroduces the drift this module exists to remove.
 *
 * Node-only: `listProviders()` reads process.env and pi-ai's catalog. Call it
 * server-side and pass the serialized result to the browser.
 */

import { findEnvKeys, getEnvApiKey, getModels, getProviders } from "@earendil-works/pi-ai";
import type { KnownProvider } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvHarness } from "./auth.js";
import {
  CROFAI_API_KEY_ENV,
  CROFAI_PROVIDER_CONFIG,
  CROFAI_PROVIDER_NAME,
} from "./providers/crofai.js";

// The config shape ModelRegistry.registerProvider accepts (not re-exported from
// the package root). Mirrors the type crofai.ts derives the same way.
type ProviderConfigInput = Parameters<ModelRegistry["registerProvider"]>[1];

// ── Unified wire shape (the one public contract) ────────────────────────────────

/** A single model, in a UI-friendly (serializable) shape. */
export type ProviderModel = {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  /** Context window in tokens. */
  readonly contextWindow: number;
  /** Max output tokens. */
  readonly maxTokens: number;
  /** USD per 1M tokens. */
  readonly cost: { readonly input: number; readonly output: number };
};

/** A provider plus its models, its auth method, and whether a credential is present. */
export type Provider = {
  readonly id: string;
  readonly name: string;
  /** True when an API key (or OAuth login) for this provider is configured. */
  readonly authenticated: boolean;
  /** How the provider authenticates — drives the UI hint. */
  readonly auth: "api-key" | "oauth";
  /**
   * Env vars that supply this provider's API key. `[]` for OAuth providers.
   * Drives the "set X in .env.harness" hint; the first entry is the canonical one.
   */
  readonly requiredEnvVars: readonly string[];
  readonly models: readonly ProviderModel[];
};

// ── Custom providers (append one object to add a provider) ───────────────────────

export type CustomProviderDef = {
  /** Provider id used everywhere (phase models, chat selection, registry lookup). */
  readonly id: string;
  /** Env var holding this provider's API key. */
  readonly envVar: string;
  /** Config registered with the SDK's ModelRegistry at runtime. */
  readonly config: ProviderConfigInput;
};

/**
 * Custom providers registered with the SDK at runtime (not in pi-ai's static
 * catalog). The catalog enumeration, the SDK registration, and every credential
 * check iterate this array — adding a provider is a single append here.
 */
export const CUSTOM_PROVIDERS: readonly CustomProviderDef[] = [
  {
    id: CROFAI_PROVIDER_NAME,
    envVar: CROFAI_API_KEY_ENV,
    config: CROFAI_PROVIDER_CONFIG,
  },
];

const CUSTOM_BY_ID = new Map(CUSTOM_PROVIDERS.map((p) => [p.id, p]));

// ── Built-in provider metadata ──────────────────────────────────────────────────

/**
 * Canonical env-var names for built-in providers — what we tell the user to set
 * (pi-ai's findEnvKeys only reports vars that are *already set*, so it can't
 * supply the name when the key is missing). The first entry is preferred.
 */
const BUILT_IN_PROVIDER_ENV: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "azure-openai-responses": ["AZURE_OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  google: ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  zai: ["ZAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  huggingface: ["HF_TOKEN"],
  fireworks: ["FIREWORKS_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY"],
  "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
  "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
  "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
};

/** Providers that authenticate via OAuth login (pi `/login`), not an env var. */
export const OAUTH_PROVIDERS: ReadonlySet<string> = new Set(["openai-codex", "github-copilot"]);

/** Curated display names; falls back to a humanized id otherwise. */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  "azure-openai-responses": "Azure OpenAI",
  google: "Google Gemini",
  "google-vertex": "Google Vertex",
  "amazon-bedrock": "Amazon Bedrock",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  zai: "Z.AI",
  mistral: "Mistral",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax (CN)",
  moonshotai: "MoonshotAI",
  "moonshotai-cn": "MoonshotAI (CN)",
  huggingface: "Hugging Face",
  fireworks: "Fireworks",
  cloudflare: "Cloudflare",
  [CROFAI_PROVIDER_NAME]: CROFAI_PROVIDER_CONFIG.name ?? "CrofAI",
};

function providerDisplayName(id: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[id] ??
    id
      .split("-")
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

// ── Credential helpers (used by session creation) ───────────────────────────────

export function isOAuthProvider(id: string): boolean {
  return OAUTH_PROVIDERS.has(id);
}

export function isCustomProvider(id: string): boolean {
  return CUSTOM_BY_ID.has(id);
}

/** The env var holding a custom provider's API key, or undefined if not custom. */
export function customProviderEnv(id: string): string | undefined {
  return CUSTOM_BY_ID.get(id)?.envVar;
}

/** The SDK registration config for a custom provider, or undefined if not custom. */
export function customProviderConfig(id: string): ProviderConfigInput | undefined {
  return CUSTOM_BY_ID.get(id)?.config;
}

/**
 * Env var names that supply this provider's API key (`[]` for OAuth). For
 * built-ins this is the canonical-name map; for custom providers, their one
 * configured env var.
 */
export function requiredEnvVarsFor(id: string): readonly string[] {
  if (OAUTH_PROVIDERS.has(id)) return [];
  const custom = CUSTOM_BY_ID.get(id);
  if (custom) return [custom.envVar];
  return BUILT_IN_PROVIDER_ENV[id] ?? [];
}

function nonEmptyEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Resolve a provider's API key from the environment. Custom providers use their
 * single configured env var; built-ins try the canonical names, then any var
 * pi-ai recognizes (findEnvKeys), then pi-ai's own resolver (getEnvApiKey).
 */
export function apiKeyFromEnv(id: string): string | undefined {
  const customEnv = CUSTOM_BY_ID.get(id)?.envVar;
  if (customEnv !== undefined) return nonEmptyEnv(customEnv);

  for (const envKey of requiredEnvVarsFor(id)) {
    const key = nonEmptyEnv(envKey);
    if (key) return key;
  }
  for (const envKey of findEnvKeys(id) ?? []) {
    const key = nonEmptyEnv(envKey);
    if (key) return key;
  }
  return getEnvApiKey(id) || undefined;
}

/** Whether a credential (env API key or OAuth login) is present for this provider. */
function isAuthenticated(id: string): boolean {
  if (OAUTH_PROVIDERS.has(id)) return hasOAuthCredential(id);
  return apiKeyFromEnv(id) !== undefined;
}

/** Whether an OAuth login (pi `/login`) is present for this provider. */
export function hasOAuthCredential(id: string): boolean {
  // OAuth credentials live in ~/.pi/agent/auth.json (written by pi `/login`).
  const home = process.env["HOME"] ?? "";
  if (home.length === 0) return false;
  const path = join(home, ".pi", "agent", "auth.json");
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const entry = raw[id];
    return (
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      (entry as { type?: unknown }).type === "oauth"
    );
  } catch {
    return false;
  }
}

// ── The single enumeration ──────────────────────────────────────────────────────

function builtInModels(providerId: KnownProvider): readonly ProviderModel[] {
  return getModels(providerId).map(
    (m): ProviderModel => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      cost: { input: m.cost.input, output: m.cost.output },
    }),
  );
}

function customModels(def: CustomProviderDef): readonly ProviderModel[] {
  return (def.config.models ?? []).map(
    (m): ProviderModel => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      cost: { input: m.cost.input, output: m.cost.output },
    }),
  );
}

/**
 * Enumerate every provider + model pi supports — pi-ai's built-in catalog plus
 * our runtime-registered custom providers — each flagged `authenticated` using
 * the same credential resolution session creation uses. Providers with no models
 * are dropped (nothing selectable). Sorted authenticated-first, then by name.
 *
 * Loads .env.harness first so auth flags match what a real session would see.
 */
export function listProviders(): Provider[] {
  loadEnvHarness();

  const out: Provider[] = [];

  for (const id of getProviders()) {
    const models = builtInModels(id);
    if (models.length === 0) continue;
    out.push({
      id,
      name: providerDisplayName(id),
      authenticated: isAuthenticated(id),
      auth: OAUTH_PROVIDERS.has(id) ? "oauth" : "api-key",
      requiredEnvVars: requiredEnvVarsFor(id),
      models,
    });
  }

  for (const def of CUSTOM_PROVIDERS) {
    const models = customModels(def);
    if (models.length === 0) continue;
    out.push({
      id: def.id,
      name: providerDisplayName(def.id),
      authenticated: isAuthenticated(def.id),
      auth: "api-key",
      requiredEnvVars: [def.envVar],
      models,
    });
  }

  return out.sort((a, b) => {
    if (a.authenticated !== b.authenticated) return a.authenticated ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
