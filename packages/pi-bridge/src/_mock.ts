// Adapter abstraction so tests can inject a stub instead of the real pi SDK.
export type PiSdkSession = {
  prompt: (text: string) => Promise<{
    finalText: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  close: () => Promise<void>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

export type PiSdkAdapter = {
  createAgentSession: (opts: { cwd: string; systemPrompt?: string }) => Promise<PiSdkSession>;
};

export type MockPiAdapter = PiSdkAdapter;
