// ── Thinking levels ───────────────────────────────────────────────────────────

export const CHAT_THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ChatThinkingLevel = (typeof CHAT_THINKING_LEVELS)[number];

// ── Domain types ──────────────────────────────────────────────────────────────

export type ChatRole = "user" | "assistant";

export type ChatModelSelection = {
  readonly provider: string;
  readonly model: string;
  readonly thinkingLevel: ChatThinkingLevel;
};

/** One assistant message is built from ordered parts as frames arrive. */
export type ChatMessagePart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly callId: string;
      readonly tool: string;
      readonly input: unknown;
      readonly status: "running" | "ok" | "error";
      readonly output?: unknown;
    };

export type ChatMessage = {
  readonly id: string;
  readonly threadId: string;
  readonly role: ChatRole;
  readonly createdAt: Date;
  /** User messages contain a single text part; assistant messages accumulate parts as frames arrive. */
  readonly parts: readonly ChatMessagePart[];
  readonly status: "streaming" | "complete" | "stopped" | "error";
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  };
  readonly error?: string;
};

export type ChatThread = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly branch?: string;
  readonly model: ChatModelSelection;
};

// ── SSE stream frames ─────────────────────────────────────────────────────────
// Translates 1:1 from PiBridgeEvent variants, plus lifecycle frames.
// Pattern mirrors LiveEventPayloadByKind in live-event.ts.

export type ChatStreamPayloadByKind = {
  readonly "chat.delta": {
    readonly messageId: string;
    readonly text: string;
  };
  readonly "chat.thinking": {
    readonly messageId: string;
    readonly text: string;
  };
  readonly "chat.tool_call": {
    readonly messageId: string;
    readonly callId: string;
    readonly tool: string;
    readonly input: unknown;
  };
  readonly "chat.tool_result": {
    readonly messageId: string;
    readonly callId: string;
    readonly tool: string;
    readonly ok: boolean;
    readonly output?: unknown;
  };
  readonly "chat.turn_end": {
    readonly messageId: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly costUsd: number;
    };
  };
  readonly "chat.stopped": {
    readonly messageId: string;
  };
  readonly "chat.error": {
    readonly messageId: string;
    readonly text: string;
  };
};

export type ChatStreamKind = keyof ChatStreamPayloadByKind;

export type ChatStreamFrame<K extends ChatStreamKind = ChatStreamKind> = {
  readonly id: string;
  readonly sequence: number;
  readonly ts: Date;
  readonly threadId: string;
  readonly kind: K;
  readonly payload: ChatStreamPayloadByKind[K];
};

// ── Runtime guard ─────────────────────────────────────────────────────────────

const CHAT_STREAM_KINDS = new Set<string>([
  "chat.delta",
  "chat.thinking",
  "chat.tool_call",
  "chat.tool_result",
  "chat.turn_end",
  "chat.stopped",
  "chat.error",
] satisfies ChatStreamKind[]);

/** Runtime guard that narrows an unknown value to `ChatStreamKind`. */
export function isChatStreamKind(x: unknown): x is ChatStreamKind {
  return typeof x === "string" && CHAT_STREAM_KINDS.has(x);
}
