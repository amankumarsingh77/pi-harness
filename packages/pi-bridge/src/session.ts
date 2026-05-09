import type { PiSession, PiSessionOptions } from "./types.js";
import type { PiSdkAdapter, PiSdkSession } from "./_mock.js";

let defaultAdapterPromise: Promise<PiSdkAdapter> | null = null;

async function getDefaultAdapter(): Promise<PiSdkAdapter> {
  if (!defaultAdapterPromise) {
    defaultAdapterPromise = (async (): Promise<PiSdkAdapter> => {
      const mod = await import("@earendil-works/pi-coding-agent");
      const adapter: PiSdkAdapter = {
        createAgentSession: async (opts) => {
          // The real SDK call. We expose a uniform interface so tests can mock it.
          // SDK types may evolve; pin via package.json.
          const sdkArgs: { cwd: string; systemPrompt?: string } = { cwd: opts.cwd };
          if (opts.systemPrompt !== undefined) sdkArgs.systemPrompt = opts.systemPrompt;
          const session = await mod.createAgentSession(sdkArgs);
          return session as unknown as PiSdkSession;
        },
      };
      return adapter;
    })();
  }
  return defaultAdapterPromise as Promise<PiSdkAdapter>;
}

export async function createSession(
  opts: PiSessionOptions,
  adapter?: PiSdkAdapter,
): Promise<PiSession> {
  const sdk = adapter ?? (await getDefaultAdapter());
  const sessionOpts: { cwd: string; systemPrompt?: string } = { cwd: opts.cwd };
  if (opts.systemPrompt !== undefined) sessionOpts.systemPrompt = opts.systemPrompt;
  const sdkSession = await sdk.createAgentSession(sessionOpts);

  // Wire SDK events into onEvent. Names approximate the SDK's event surface.
  sdkSession.on("text_delta", (text: unknown) => {
    if (typeof text === "string") opts.onEvent({ kind: "message_delta", text });
  });
  sdkSession.on("tool_execution_start", (tool: unknown) => {
    if (typeof tool === "string") opts.onEvent({ kind: "tool_call", tool, input: undefined });
  });
  sdkSession.on("tool_execution_end", (info: unknown) => {
    const o = info as { tool?: string; ok?: boolean } | undefined;
    if (o?.tool) opts.onEvent({ kind: "tool_result", tool: o.tool, ok: !!o.ok });
  });

  return {
    async prompt(text: string) {
      return sdkSession.prompt(text);
    },
    async close() {
      await sdkSession.close();
    },
  };
}
