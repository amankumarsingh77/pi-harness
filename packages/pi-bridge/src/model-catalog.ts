import { getEnvApiKey, getModels, getProviders, type KnownProvider } from "@earendil-works/pi-ai";
import { parse as parseDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CROFAI_API_KEY_ENV,
  CROFAI_PROVIDER_CONFIG,
  CROFAI_PROVIDER_NAME,
} from "./providers/crofai.js";

type Env = Readonly<Record<string, string | undefined>>;

export type ModelCatalogCredential =
  | {
      kind: "env";
      configured: boolean;
      requiredEnvVars: readonly string[];
    }
  | {
      kind: "oauth";
      configured: boolean;
      label: string;
    }
  | {
      kind: "ambient";
      configured: boolean;
      label: string;
    };

export type ModelCatalogModel = {
  id: string;
  label: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
};

export type ModelCatalogProvider = {
  id: string;
  label: string;
  credential: ModelCatalogCredential;
  models: readonly ModelCatalogModel[];
};

export type ModelCatalog = {
  providers: readonly ModelCatalogProvider[];
};

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

const OAUTH_PROVIDERS = new Set(["openai-codex", "github-copilot"]);

export function buildModelCatalog(opts: { env?: Env } = {}): ModelCatalog {
  const env = opts.env ?? readRuntimeEnv();
  const providers = [
    ...getProviders().map((provider) => buildBuiltInProvider(provider, env)),
    buildCrofaiProvider(env),
  ].filter((provider): provider is ModelCatalogProvider => provider !== null);

  return { providers };
}

function readRuntimeEnv(): Env {
  const fileEnv = readEnvHarnessFile(process.cwd());
  return Object.fromEntries([
    ...Object.entries(fileEnv),
    ...Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
  ]);
}

function readEnvHarnessFile(start: string): Env {
  const root = findMonorepoRoot(start);
  const path = join(root, ".env.harness");
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path));
}

function findMonorepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function buildBuiltInProvider(provider: KnownProvider, env: Env): ModelCatalogProvider | null {
  const models = getModels(provider).map((model) => ({
    id: model.id,
    label: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));
  if (models.length === 0) return null;
  return {
    id: provider,
    label: labelForProvider(provider),
    credential: credentialForBuiltInProvider(provider, env),
    models,
  };
}

function buildCrofaiProvider(env: Env): ModelCatalogProvider | null {
  const models = (CROFAI_PROVIDER_CONFIG.models ?? []).map((model) => ({
    id: model.id,
    label: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));
  if (models.length === 0) return null;
  return {
    id: CROFAI_PROVIDER_NAME,
    label: CROFAI_PROVIDER_CONFIG.name ?? labelForProvider(CROFAI_PROVIDER_NAME),
    credential: {
      kind: "env",
      configured: hasAnyEnv(env, [CROFAI_API_KEY_ENV]),
      requiredEnvVars: [CROFAI_API_KEY_ENV],
    },
    models,
  };
}

function credentialForBuiltInProvider(provider: KnownProvider, env: Env): ModelCatalogCredential {
  if (OAUTH_PROVIDERS.has(provider)) {
    return {
      kind: "oauth",
      configured: false,
      label: "Run /login in pi for this provider.",
    };
  }

  const envVars = BUILT_IN_PROVIDER_ENV[provider];
  if (envVars !== undefined) {
    return {
      kind: "env",
      configured: hasAnyEnv(env, envVars),
      requiredEnvVars: envVars,
    };
  }

  return {
    kind: "ambient",
    configured: getEnvApiKey(provider) !== undefined,
    label: "Configure this provider's credentials in the Pi environment.",
  };
}

function hasAnyEnv(env: Env, keys: readonly string[]): boolean {
  return keys.some((key) => (env[key] ?? "").trim().length > 0);
}

function labelForProvider(provider: string): string {
  return provider
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
