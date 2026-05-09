import type { PiBridgeEvent } from "./types.js";
import { AuthError, getApiKey, __resetAuthCache } from "./auth.js";

export { AuthError, __resetAuthCache };

// We intentionally type SDK events loosely here: the bridge only inspects fields
// it knows about. Phase 6's live smoke covers the real SDK end-to-end.
export type AgentSdkEvent = { type: string } & Record<string, unknown>;

export type AgentSdkSession = {
  subscribe: (listener: (event: AgentSdkEvent) => void) => () => void;
  prompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  readonly sessionFile?: string | undefined;
};

// Mirrors the inputs the bridge needs to construct the SDK session. The real
// adapter resolves these into the SDK's CreateAgentSessionOptions; the fake
// adapter just records them.
export type AgentSdkCreateOptions = {
  cwd: string;
  model: { provider: string; model: string };
  apiKey: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string;
  customTools?: ToolDefinitionLike[];
  sessionPath?: string;
};

export type AgentSdkAdapter = {
  create: (opts: AgentSdkCreateOptions) => Promise<{ session: AgentSdkSession }>;
};

// Re-exported loosely so callers don't have to import from the SDK package
// (which would couple every consumer to the SDK's deep paths).
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
export type ToolDefinitionLike = { name: string; description?: string };

export type AgentSessionOptions = {
  cwd: string;
  model: { provider: string; model: string };
  thinkingLevel?: ThinkingLevel;
  maxTurns?: number;
  systemPrompt?: string;
  customTools?: ToolDefinitionLike[];
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
  close(): Promise<void>;
};

type InFlight = {
  resolve: (u: PromptUsage) => void;
  reject: (err: Error) => void;
  turnCount: number;
  settled: boolean;
};

let defaultAdapterPromise: Promise<AgentSdkAdapter> | null = null;

async function getDefaultAdapter(): Promise<AgentSdkAdapter> {
  if (!defaultAdapterPromise) {
    defaultAdapterPromise = (async (): Promise<AgentSdkAdapter> => {
      const sdk = (await import("@earendil-works/pi-coding-agent")) as unknown as Record<
        string,
        unknown
      > & {
        createAgentSession: (o: Record<string, unknown>) => Promise<{ session: unknown }>;
        SessionManager: {
          open: (p: string) => unknown;
          inMemory: (cwd?: string) => unknown;
        };
        DefaultResourceLoader: new (o: Record<string, unknown>) => { reload: () => Promise<void> };
        createCodingTools: (cwd: string) => unknown[];
        getAgentDir: () => string;
      };
      const ai = (await import("@earendil-works/pi-ai")) as {
        getModel: (p: string, m: string) => unknown;
      };
      return {
        async create(opts) {
          const model = ai.getModel(opts.model.provider, opts.model.model);
          const sessionManager = opts.sessionPath
            ? sdk.SessionManager.open(opts.sessionPath)
            : sdk.SessionManager.inMemory(opts.cwd);
          const tools = sdk.createCodingTools(opts.cwd);
          const customTools = opts.customTools ?? [];
          const sdkOpts: Record<string, unknown> = {
            cwd: opts.cwd,
            model,
            sessionManager,
            customTools: [...tools, ...customTools],
            ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
          };
          if (opts.systemPrompt !== undefined) {
            // DefaultResourceLoader.appendSystemPrompt appends after pi's default.
            const loader = new sdk.DefaultResourceLoader({
              cwd: opts.cwd,
              agentDir: sdk.getAgentDir(),
              appendSystemPrompt: [opts.systemPrompt],
            });
            await loader.reload();
            sdkOpts["resourceLoader"] = loader;
          }
          const result = (await sdk.createAgentSession(sdkOpts)) as {
            session: AgentSdkSessionLike;
          };
          const session = result.session;
          const adapterSession: AgentSdkSession = {
            subscribe: (l) => session.subscribe(l),
            prompt: (text) => session.prompt(text),
            abort: () => session.abort(),
            dispose: () => session.dispose(),
            get sessionFile() {
              return session.sessionFile;
            },
          };
          return { session: adapterSession };
        },
      };
    })();
  }
  return defaultAdapterPromise;
}

type AgentSdkSessionLike = {
  subscribe: (listener: (event: AgentSdkEvent) => void) => () => void;
  prompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  readonly sessionFile?: string | undefined;
};

export async function createAgentSession(
  opts: AgentSessionOptions,
  adapter?: AgentSdkAdapter,
): Promise<AgentSession> {
  // Auth gate before we even create the session — fail fast with AuthError
  // so the orchestrator can route to phase_blocked without spinning up the SDK.
  const apiKey = getApiKey(opts.model.provider);

  const sdk = adapter ?? (await getDefaultAdapter());
  const createOpts: AgentSdkCreateOptions = {
    cwd: opts.cwd,
    model: opts.model,
    apiKey,
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
    ...(opts.customTools !== undefined ? { customTools: opts.customTools } : {}),
    ...(opts.sessionPath !== undefined ? { sessionPath: opts.sessionPath } : {}),
  };
  const { session: sdkSession } = await sdk.create(createOpts);

  let inFlight: InFlight | null = null;
  const maxTurns = opts.maxTurns;

  function emit(e: PiBridgeEvent): void {
    opts.onEvent(e);
  }

  function settleResolve(usage: PromptUsage): void {
    if (!inFlight || inFlight.settled) return;
    inFlight.settled = true;
    const f = inFlight;
    inFlight = null;
    f.resolve(usage);
  }

  function settleReject(err: Error): void {
    if (!inFlight || inFlight.settled) return;
    inFlight.settled = true;
    const f = inFlight;
    inFlight = null;
    f.reject(err);
  }

  sdkSession.subscribe((event: AgentSdkEvent) => {
    switch (event.type) {
      case "turn_start": {
        if (!inFlight) return;
        inFlight.turnCount += 1;
        if (maxTurns !== undefined && inFlight.turnCount > maxTurns) {
          emit({ kind: "error", text: "maxTurns exceeded" });
          // Best-effort abort; even if it rejects we still settle the prompt.
          void sdkSession.abort().catch(() => {});
          settleReject(new Error("maxTurns exceeded"));
        }
        return;
      }
      case "message_update": {
        const ame = event["assistantMessageEvent"] as
          | { type?: string; delta?: string }
          | undefined;
        if (ame?.type === "text_delta" && typeof ame.delta === "string") {
          emit({ kind: "message_delta", text: ame.delta });
        }
        // thinking_delta intentionally dropped (parking-lot per phase-2.md).
        return;
      }
      case "tool_execution_start": {
        const tool = event["toolName"];
        const input = event["args"];
        if (typeof tool === "string") emit({ kind: "tool_call", tool, input });
        return;
      }
      case "tool_execution_end": {
        const tool = event["toolName"];
        const isError = event["isError"] === true;
        const output = event["result"];
        if (typeof tool === "string") {
          emit({ kind: "tool_result", tool, ok: !isError, output });
        }
        return;
      }
      case "auto_retry_start": {
        const attempt = event["attempt"];
        const errorMessage = event["errorMessage"];
        emit({
          kind: "log",
          level: "warn",
          text: `auto_retry attempt ${String(attempt)}: ${String(errorMessage)}`,
        });
        return;
      }
      case "agent_end": {
        const messages = (event["messages"] as Array<Record<string, unknown>>) ?? [];
        let inputTokens = 0;
        let outputTokens = 0;
        let costUsd = 0;
        for (const m of messages) {
          if (m["role"] !== "assistant") continue;
          const usage = m["usage"] as
            | {
                input?: number;
                output?: number;
                cost?: { total?: number };
              }
            | undefined;
          if (!usage) continue;
          inputTokens += usage.input ?? 0;
          outputTokens += usage.output ?? 0;
          costUsd += usage.cost?.total ?? 0;
        }
        const usage: PromptUsage = { inputTokens, outputTokens, costUsd };
        emit({ kind: "turn_end", usage });
        settleResolve(usage);
        return;
      }
      default:
        return;
    }
  });

  return {
    async prompt(text: string): Promise<PromptUsage> {
      if (inFlight) {
        throw new Error("agent-session: prompt already in flight");
      }
      const promise = new Promise<PromptUsage>((resolve, reject) => {
        inFlight = { resolve, reject, turnCount: 0, settled: false };
      });
      // Kick the SDK; if it throws synchronously the in-flight gate must clear.
      try {
        await sdkSession.prompt(text);
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)));
      }
      return promise;
    },
    async close(): Promise<void> {
      sdkSession.dispose();
    },
  };
}
