import {
  createAgentSession as sdkCreateAgentSession,
  SessionManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
  getAgentDir,
  type AgentSession as SdkAgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { findEnvKeys, getEnvApiKey, getModel } from "@earendil-works/pi-ai";
import type { AssistantMessage, KnownProvider, Usage } from "@earendil-works/pi-ai";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthError, loadEnvHarness } from "./auth.js";
import {
  CROFAI_API_KEY_ENV,
  CROFAI_PROVIDER_CONFIG,
  CROFAI_PROVIDER_NAME,
} from "./providers/crofai.js";

export { AuthError };
export type { ThinkingLevel, ToolDefinition };

// The bridge's outward event surface. Owned here because agent-session is the
// sole producer (see sdkSession.subscribe below) and consumers (orchestrator's
// brainstorm driver, runner/phase-prompts) only see this shape — never the
// raw SDK AgentSessionEvent. Variants map 1:1 to the switch arms below.
export type PiBridgeEvent =
  | { kind: "message_delta"; text: string }
  | { kind: "tool_call"; tool: string; input: unknown }
  | { kind: "tool_result"; tool: string; ok: boolean; output?: unknown }
  | { kind: "log"; level: "info" | "warn" | "error"; text: string }
  | {
      kind: "turn_end";
      usage: { inputTokens: number; outputTokens: number; costUsd: number };
    }
  | { kind: "error"; text: string };

export type AgentSessionOptions = {
  cwd: string;
  model: { provider: string; model: string };
  thinkingLevel?: ThinkingLevel;
  // Deprecated no-op. Kept so older orchestrator callers do not break, but
  // turn-count caps are no longer enforced anywhere in the pipeline.
  maxTurns?: number;
  systemPrompt?: string;
  customTools?: ToolDefinition[];
  // Allowlist of SDK tool names. The pi SDK applies this filter to both
  // built-ins and custom tools, so openSession augments it with custom tool
  // names before constructing the SDK session.
  tools?: string[];
  sessionPath?: string;
  onEvent: (e: PiBridgeEvent) => void;
};

export type PromptUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type AgentSession = {
  prompt(text: string): Promise<PromptUsage>;
  abort(): Promise<void>;
  close(): Promise<void>;
};

// Inputs the boundary needs to construct an SDK session. Tests inject a fake
// boundary so they can drive the event stream without touching the real SDK.
// Production callers never see this type.
export type SdkBoundaryCreateOptions = {
  cwd: string;
  model: { provider: string; model: string };
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string;
  customTools?: ToolDefinition[];
  tools?: string[];
  sessionPath?: string;
};

export type SdkBoundary = {
  create: (opts: SdkBoundaryCreateOptions) => Promise<{ session: SdkAgentSession }>;
};

// Providers we register with the SDK at runtime (not in pi-ai's static MODELS).
// Maps provider name -> env var that holds the API key. assertCredential and
// the registry builder both read this so the auth surface stays uniform.
const CUSTOM_PROVIDER_ENV: Record<string, string> = {
  [CROFAI_PROVIDER_NAME]: CROFAI_API_KEY_ENV,
};

const OAUTH_PROVIDERS = new Set(["openai-codex", "github-copilot"]);

// Lazy per-process registry. Built once on first session creation; reused for
// every subsequent session so the orchestrator doesn't re-register providers
// each phase tick. The registry resolves credentials via setRuntimeApiKey
// (populated from .env.harness) — that's why loadEnvHarness must run first.
let authStorage: AuthStorage | null = null;
let registryPromise: Promise<ModelRegistry> | null = null;

function buildCustomRegistry(): ModelRegistry {
  const auth = getAuthStorage();
  const registry = ModelRegistry.create(auth);
  registry.registerProvider(CROFAI_PROVIDER_NAME, CROFAI_PROVIDER_CONFIG);
  return registry;
}

function getAuthStorage(): AuthStorage {
  authStorage ??= AuthStorage.create();
  return authStorage;
}

async function getRegistry(): Promise<ModelRegistry> {
  if (!registryPromise) {
    registryPromise = Promise.resolve(buildCustomRegistry());
  }
  return registryPromise;
}

// Test-only: clear the cached registry between tests so .env.harness changes
// take effect. Mirrors __resetAuthCache from auth.ts.
export function __resetRegistryCache(): void {
  authStorage = null;
  registryPromise = null;
}

const defaultBoundary: SdkBoundary = {
  create: async (opts) => {
    const registry = await getRegistry();
    const model = resolveModel(opts.model, registry);
    const sessionManager = opts.sessionPath
      ? SessionManager.open(opts.sessionPath)
      : SessionManager.inMemory(opts.cwd);
    const sdkOpts: CreateAgentSessionOptions = {
      cwd: opts.cwd,
      model,
      authStorage: getAuthStorage(),
      modelRegistry: registry,
      sessionManager,
      customTools: opts.customTools ?? [],
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
      ...(opts.systemPrompt !== undefined
        ? { resourceLoader: await buildResourceLoader(opts.cwd, opts.systemPrompt) }
        : {}),
    };
    const result = await sdkCreateAgentSession(sdkOpts);
    return { session: result.session };
  },
};

export async function createAgentSession(
  opts: AgentSessionOptions,
  boundary: SdkBoundary = defaultBoundary,
): Promise<AgentSession> {
  loadEnvHarness();
  syncRuntimeApiKey(opts.model.provider);
  assertCredential(opts.model.provider);

  const sdkSession = await openSession(boundary, opts);

  type Pending = {
    resolve: (u: PromptUsage) => void;
    reject: (err: Error) => void;
    turnCount: number;
    settled: boolean;
  };
  let pending: Pending | null = null;

  const settle = (fn: (p: Pending) => void): void => {
    if (!pending || pending.settled) return;
    pending.settled = true;
    const p = pending;
    pending = null;
    fn(p);
  };

  sdkSession.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case "turn_start": {
        if (!pending) return;
        pending.turnCount += 1;
        return;
      }
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          opts.onEvent({ kind: "message_delta", text: ame.delta });
        }
        // thinking_delta intentionally dropped (parking-lot per phase-2.md).
        return;
      }
      case "tool_execution_start": {
        opts.onEvent({ kind: "tool_call", tool: event.toolName, input: event.args });
        return;
      }
      case "tool_execution_end": {
        opts.onEvent({
          kind: "tool_result",
          tool: event.toolName,
          ok: !event.isError,
          output: event.result,
        });
        return;
      }
      case "auto_retry_start": {
        opts.onEvent({
          kind: "log",
          level: "warn",
          text: `auto_retry attempt ${event.attempt}: ${event.errorMessage}`,
        });
        return;
      }
      case "agent_end": {
        const usage = sumAssistantUsage(event.messages);
        opts.onEvent({ kind: "turn_end", usage });
        settle((p) => p.resolve(usage));
        return;
      }
      default:
        return;
    }
  });

  return {
    async prompt(text: string): Promise<PromptUsage> {
      if (pending || sdkSession.isStreaming) {
        throw new Error("agent-session: prompt already in flight");
      }
      const promise = new Promise<PromptUsage>((resolve, reject) => {
        pending = { resolve, reject, turnCount: 0, settled: false };
      });
      try {
        await sdkSession.prompt(text);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        settle((p) => p.reject(error));
      }
      return promise;
    },
    async abort(): Promise<void> {
      // Cancel any in-flight turn at the SDK level and reject the pending
      // prompt with a recognizable error so the caller doesn't wait on the
      // SDK's unwind. Safe to call when no prompt is in flight.
      await sdkSession.abort().catch(() => {});
      settle((p) => p.reject(new Error("aborted")));
    },
    async close(): Promise<void> {
      sdkSession.dispose();
    },
  };
}

function resolveModel(spec: { provider: string; model: string }, registry: ModelRegistry) {
  // Custom providers (registered at runtime via ModelRegistry) aren't in
  // pi-ai's static MODELS, so getModel would throw. Consult the registry
  // first; fall back to pi-ai for built-in providers.
  if (spec.provider in CUSTOM_PROVIDER_ENV) {
    const found = registry.find(spec.provider, spec.model);
    if (!found) {
      throw new AuthError(
        `unknown model ${spec.provider}/${spec.model}: not registered in custom provider registry`,
      );
    }
    return found;
  }
  // The SDK's `getModel` is generic over the literal provider/model union and
  // refuses bare strings at the type level. We accept arbitrary provider/model
  // strings at our boundary (orchestrator config is dynamic) and let the SDK
  // throw at runtime if the pair is unknown — that error is caught and rewrapped
  // as AuthError so callers get a uniform failure type.
  try {
    return (getModel as unknown as (p: string, m: string) => ReturnType<typeof getModel<KnownProvider, never>>)(
      spec.provider,
      spec.model,
    );
  } catch (err) {
    throw new AuthError(
      `unknown model ${spec.provider}/${spec.model}: ${(err as Error).message}`,
    );
  }
}

// The SDK throws on missing credentials. We catch and rewrap as AuthError so
// brainstorm.ts (the only consumer) can `instanceof AuthError` to route the
// failure into a phase_blocked state instead of a crash. Non-auth errors fall
// through unchanged so callers can apply their own recovery (e.g., the
// brainstorm corrupted-session-file retry).
async function openSession(
  boundary: SdkBoundary,
  opts: AgentSessionOptions,
): Promise<SdkAgentSession> {
  try {
    const create: SdkBoundaryCreateOptions = {
      cwd: opts.cwd,
      model: opts.model,
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
      ...(opts.customTools !== undefined ? { customTools: opts.customTools } : {}),
      ...(opts.tools !== undefined ? { tools: allowlistedTools(opts.tools, opts.customTools) } : {}),
      ...(opts.sessionPath !== undefined ? { sessionPath: opts.sessionPath } : {}),
    };
    const { session } = await boundary.create(create);
    return session;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const message = (err as Error).message;
    if (looksLikeAuthFailure(message)) {
      throw new AuthError(`missing API key for ${opts.model.provider}: ${message}`);
    }
    throw err;
  }
}

function allowlistedTools(
  tools: readonly string[],
  customTools: readonly ToolDefinition[] | undefined,
): string[] {
  const out = new Set(tools);
  for (const tool of customTools ?? []) {
    out.add(tool.name);
  }
  return [...out];
}

function syncRuntimeApiKey(provider: string): void {
  if (OAUTH_PROVIDERS.has(provider)) return;
  const apiKey = apiKeyFromEnv(provider);
  if (apiKey) {
    getAuthStorage().setRuntimeApiKey(provider, apiKey);
  }
}

function apiKeyFromEnv(provider: string): string | undefined {
  const customEnv = CUSTOM_PROVIDER_ENV[provider];
  if (customEnv !== undefined) {
    return nonEmptyEnv(customEnv);
  }

  for (const envKey of findEnvKeys(provider) ?? []) {
    const apiKey = nonEmptyEnv(envKey);
    if (apiKey) return apiKey;
  }
  return getEnvApiKey(provider) || undefined;
}

function nonEmptyEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

// Upfront credential check using the SDK's own provider→env-var registry
// (findEnvKeys / getEnvApiKey). Throws AuthError before the SDK is touched so
// brainstorm.ts can route the failure into a phase_blocked state without
// spinning up a session.
function assertCredential(provider: string): void {
  // Custom providers aren't in pi-ai's env-key registry; check our own map first.
  const customEnv = CUSTOM_PROVIDER_ENV[provider];
  if (customEnv !== undefined) {
    if (process.env[customEnv]) return;
    throw new AuthError(`missing API key for ${provider} (expected ${customEnv} in .env.harness)`);
  }
  if (OAUTH_PROVIDERS.has(provider)) {
    if (hasOAuthCredential(provider)) return;
    throw new AuthError(`missing subscription login for ${provider} (run /login in pi)`);
  }
  if (getEnvApiKey(provider)) return;
  const envVars = findEnvKeys(provider);
  const expected = envVars && envVars.length > 0 ? envVars.join(" or ") : "<unknown>";
  throw new AuthError(`missing API key for ${provider} (expected ${expected} in .env.harness)`);
}

function hasOAuthCredential(provider: string): boolean {
  const path = join(process.env["HOME"] ?? "", ".pi", "agent", "auth.json");
  if (!existsSync(path)) return false;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const entry = raw[provider];
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

function looksLikeAuthFailure(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("api key") || m.includes("auth") || m.includes("credential");
}

async function buildResourceLoader(
  cwd: string,
  systemPrompt: string,
): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    appendSystemPrompt: [systemPrompt],
  });
  await loader.reload();
  return loader;
}

function sumAssistantUsage(messages: AgentMessage[]): PromptUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const m of messages) {
    if (!isAssistantWithUsage(m)) continue;
    const usage: Usage = m.usage;
    inputTokens += usage.input ?? 0;
    outputTokens += usage.output ?? 0;
    costUsd += usage.cost?.total ?? 0;
  }
  return { inputTokens, outputTokens, costUsd };
}

function isAssistantWithUsage(m: AgentMessage): m is AssistantMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    "role" in m &&
    (m as { role: unknown }).role === "assistant" &&
    "usage" in m
  );
}
