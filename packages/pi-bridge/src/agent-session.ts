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
import { getModels } from "@earendil-works/pi-ai";
import type { AssistantMessage, KnownProvider, Usage } from "@earendil-works/pi-ai";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { AuthError, loadEnvHarness } from "./auth.js";
import {
  apiKeyFromEnv,
  customProviderEnv,
  CUSTOM_PROVIDERS,
  hasOAuthCredential,
  isCustomProvider,
  isOAuthProvider,
  requiredEnvVarsFor,
} from "./provider-registry.js";
import { randomUUID } from "node:crypto";

export { AuthError };
export type { ThinkingLevel, ToolDefinition };

// The bridge's outward event surface. Owned here because agent-session is the
// sole producer (see sdkSession.subscribe below) and consumers (orchestrator's
// brainstorm driver, runner/phase-prompts) only see this shape — never the
// raw SDK AgentSessionEvent. Variants map 1:1 to the switch arms below.
export type PiBridgeEvent =
  | { kind: "message_delta"; text: string }
  | { kind: "thinking_delta"; text: string }
  | { kind: "tool_call"; callId: string; tool: string; input: unknown }
  | { kind: "tool_result"; callId: string; tool: string; ok: boolean; output?: unknown }
  | { kind: "log"; level: "info" | "warn" | "error"; text: string }
  | {
      kind: "usage_update";
      usage: { inputTokens: number; outputTokens: number; costUsd: number };
    }
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

export type BridgeSdkSession = Pick<
  SdkAgentSession,
  "abort" | "dispose" | "isStreaming" | "prompt" | "sessionFile" | "subscribe"
>;

export type SdkBoundary = {
  create: (opts: SdkBoundaryCreateOptions) => Promise<{ session: BridgeSdkSession }>;
};

// Lazy per-process registry. Built once on first session creation; reused for
// every subsequent session so the orchestrator doesn't re-register providers
// each phase tick. The registry resolves credentials via setRuntimeApiKey
// (populated from .env.harness) — that's why loadEnvHarness must run first.
let authStorage: AuthStorage | null = null;
let registryPromise: Promise<ModelRegistry> | null = null;

function buildCustomRegistry(): ModelRegistry {
  const auth = getAuthStorage();
  const registry = ModelRegistry.create(auth);
  // Register every custom provider from the single registry source of truth.
  for (const provider of CUSTOM_PROVIDERS) {
    registry.registerProvider(provider.id, provider.config);
  }
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
      ? SessionManager.open(opts.sessionPath, undefined, opts.cwd)
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
  const pendingToolCalls = new Map<string, string[]>();
  let completedUsage = zeroPromptUsage();
  let lastEmittedUsage = zeroPromptUsage();

  const settle = (fn: (p: Pending) => void): void => {
    if (!pending || pending.settled) return;
    pending.settled = true;
    const p = pending;
    pending = null;
    fn(p);
  };

  const emitUsageUpdate = (usage: PromptUsage): void => {
    if (!pending || !hasUsage(usage) || sameUsage(usage, lastEmittedUsage)) return;
    lastEmittedUsage = usage;
    opts.onEvent({ kind: "usage_update", usage });
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
        if ("partial" in ame) {
          emitUsageUpdate(addUsage(completedUsage, usageFromAssistantMessage(ame.partial)));
        }
        if (ame.type === "text_delta") {
          opts.onEvent({ kind: "message_delta", text: ame.delta });
        } else if (ame.type === "thinking_delta") {
          // Reasoning tokens. Forwarded so the UI can render a live "thinking"
          // block (the SDK only emits these when thinkingLevel != "off").
          if (ame.delta.length > 0) {
            opts.onEvent({ kind: "thinking_delta", text: ame.delta });
          }
        } else if (ame.type === "error") {
          // The assistant stream terminated with stopReason "error" (or "aborted").
          // pi surfaces the provider/model failure here — without this arm the
          // turn would silently report `agent_end` as a successful empty turn.
          // "aborted" is the cooperative-cancel path handled elsewhere, so only
          // a genuine error becomes a user-facing error event.
          if (ame.reason === "error") {
            opts.onEvent({ kind: "error", text: assistantErrorText(ame.error) });
          }
        }
        // thinking_delta intentionally dropped (parking-lot per phase-2.md).
        return;
      }
      case "message_end": {
        if (!isAssistantWithUsage(event.message)) return;
        completedUsage = addUsage(completedUsage, usageFromAssistantMessage(event.message));
        emitUsageUpdate(completedUsage);
        return;
      }
      case "tool_execution_start": {
        const callId = toolCallId(event) ?? `call_${randomUUID()}`;
        const pending = pendingToolCalls.get(event.toolName) ?? [];
        pendingToolCalls.set(event.toolName, [...pending, callId]);
        opts.onEvent({ kind: "tool_call", callId, tool: event.toolName, input: event.args });
        return;
      }
      case "tool_execution_end": {
        const pending = pendingToolCalls.get(event.toolName) ?? [];
        const fallbackCallId = pending[0] ?? `call_${randomUUID()}`;
        const callId = toolCallId(event) ?? fallbackCallId;
        if (pending.length <= 1) pendingToolCalls.delete(event.toolName);
        else pendingToolCalls.set(event.toolName, pending.slice(1));
        opts.onEvent({
          kind: "tool_result",
          callId,
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
        // A failed turn reaches agent_end with its final assistant message
        // carrying stopReason "error". Report it as an error (the message_update
        // error arm may not have fired for every failure shape) rather than a
        // successful empty turn. The pending promise still resolves so prompt()
        // unwinds; runChatTurn's `settled` guard drops the later turn_end.
        const failed = lastAssistantError(event.messages);
        const usage = sumAssistantUsage(event.messages);
        emitUsageUpdate(usage);
        if (failed) {
          opts.onEvent({ kind: "error", text: failed });
        } else {
          opts.onEvent({ kind: "turn_end", usage });
        }
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
        completedUsage = zeroPromptUsage();
        lastEmittedUsage = zeroPromptUsage();
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

function toolCallId(event: AgentSessionEvent): string | null {
  if (!("toolCallId" in event)) return null;
  return typeof event.toolCallId === "string" && event.toolCallId.length > 0
    ? event.toolCallId
    : null;
}

function resolveModel(spec: { provider: string; model: string }, registry: ModelRegistry) {
  // Custom providers (registered at runtime via ModelRegistry) aren't in
  // pi-ai's static MODELS, so getModels would return nothing. Consult the
  // registry first; fall back to pi-ai for built-in providers.
  if (isCustomProvider(spec.provider)) {
    const found = registry.find(spec.provider, spec.model);
    if (!found) {
      throw new AuthError(
        `unknown model ${spec.provider}/${spec.model}: not registered in custom provider registry`,
      );
    }
    return found;
  }

  // Safe cast: getModels returns [] for unrecognized providers, so an unknown
  // provider falls through to the AuthError below rather than matching.
  const found = getModels(spec.provider as KnownProvider).find((model) => model.id === spec.model);
  if (found) return found;

  throw new AuthError(`unknown model ${spec.provider}/${spec.model}: not registered in pi-ai`);
}

// The SDK throws on missing credentials. We catch and rewrap as AuthError so
// brainstorm.ts (the only consumer) can `instanceof AuthError` to route the
// failure into a phase_blocked state instead of a crash. Non-auth errors fall
// through unchanged so callers can apply their own recovery (e.g., the
// brainstorm corrupted-session-file retry).
async function openSession(
  boundary: SdkBoundary,
  opts: AgentSessionOptions,
): Promise<BridgeSdkSession> {
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
  if (isOAuthProvider(provider)) return;
  const apiKey = apiKeyFromEnv(provider);
  if (apiKey) {
    getAuthStorage().setRuntimeApiKey(provider, apiKey);
  }
}

// Upfront credential check using the provider registry's resolution. Throws
// AuthError before the SDK is touched so brainstorm.ts can route the failure
// into a phase_blocked state without spinning up a session.
function assertCredential(provider: string): void {
  // Custom providers carry a single env var; report it specifically.
  const customEnv = customProviderEnv(provider);
  if (customEnv !== undefined) {
    if (process.env[customEnv]) return;
    throw new AuthError(`missing API key for ${provider} (expected ${customEnv} in .env.harness)`);
  }
  if (isOAuthProvider(provider)) {
    if (hasOAuthCredential(provider)) return;
    throw new AuthError(`missing subscription login for ${provider} (run /login in pi)`);
  }
  if (apiKeyFromEnv(provider) !== undefined) return;
  const envVars = requiredEnvVarsFor(provider);
  const expected = envVars.length > 0 ? envVars.join(" or ") : "<unknown>";
  throw new AuthError(`missing API key for ${provider} (expected ${expected} in .env.harness)`);
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

/**
 * Human-readable text for a failed assistant message. Prefers the provider's
 * errorMessage; falls back to naming the stopReason so the UI never shows a
 * blank error.
 */
function assistantErrorText(message: AssistantMessage): string {
  const raw = message.errorMessage?.trim();
  if (raw && raw.length > 0) return raw;
  return `model turn failed (stopReason: ${message.stopReason})`;
}

/**
 * Returns the error text if the last assistant message in the transcript ended
 * with stopReason "error", else null. "aborted" is intentionally excluded — it
 * is the cooperative-cancel path owned by abort().
 */
function lastAssistantError(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m === undefined || !isAssistantMessage(m)) continue;
    return m.stopReason === "error" ? assistantErrorText(m) : null;
  }
  return null;
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return (
    typeof m === "object" &&
    m !== null &&
    "role" in m &&
    (m as { role: unknown }).role === "assistant" &&
    "stopReason" in m
  );
}

function sumAssistantUsage(messages: AgentMessage[]): PromptUsage {
  let usage = zeroPromptUsage();
  for (const m of messages) {
    if (!isAssistantWithUsage(m)) continue;
    usage = addUsage(usage, usageFromAssistantMessage(m));
  }
  return usage;
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

function usageFromAssistantMessage(message: AssistantMessage | undefined): PromptUsage {
  if (message === undefined) return zeroPromptUsage();
  const usage: Usage | undefined = message.usage;
  return {
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    costUsd: usage?.cost?.total ?? 0,
  };
}

function addUsage(left: PromptUsage, right: PromptUsage): PromptUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}

function zeroPromptUsage(): PromptUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function hasUsage(usage: PromptUsage): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.costUsd > 0;
}

function sameUsage(left: PromptUsage, right: PromptUsage): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.costUsd === right.costUsd
  );
}
