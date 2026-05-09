import type { AgentEvent } from "@pi-harness/shared";

export type PiSessionOptions = {
  cwd: string;
  systemPrompt?: string;
  skills?: string[];
  signal?: AbortSignal;
  onEvent: (e: PiBridgeEvent) => void;
};

export type PiBridgeEvent =
  | { kind: "message_delta"; text: string }
  | { kind: "tool_call"; tool: string; input: unknown }
  | { kind: "tool_result"; tool: string; ok: boolean; output?: unknown }
  | { kind: "log"; level: "info" | "warn" | "error"; text: string };

export type PiSession = {
  prompt(text: string): Promise<PiPromptResult>;
  close(): Promise<void>;
};

export type PiPromptResult = {
  finalText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type PiSubagentSpec = {
  agent: string; // matches a file under subagents/, without `.md`
  task: string;
  cwd: string;
  worktree?: boolean;
  skill?: string;
  signal?: AbortSignal;
};

export type PiSubagentResult = {
  ok: boolean;
  output: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

// Typed convenience for translating PiBridgeEvent to AgentEvent at call sites.
export type EventTranslator = (e: PiBridgeEvent) => Omit<AgentEvent, "id" | "ts" | "runId" | "taskId">;
