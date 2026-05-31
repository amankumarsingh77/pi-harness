/**
 * chat-client.ts — Pure helpers for the chat SSE stream.
 *
 * Mirrors live-event-client.ts patterns:
 *   - buildChatStreamUrl  → URL builder (same shape as buildLiveStreamUrl)
 *   - parseChatFrame      → safe JSON parse + kind guard + Date hydration
 *   - mergeChatFrames     → Map-by-id dedupe + sort-by-sequence (like mergeLiveEnvelopes)
 *   - reduceChatFrames    → pure reducer: folds sorted frames into a ChatMessage
 *
 * REQ-011, REQ-013, REQ-014, REQ-022, REQ-023, REQ-050, REQ-051, REQ-052
 * EDGE-002, EDGE-003, EDGE-005
 */

import type {
  ChatMessage,
  ChatMessagePart,
  ChatStreamFrame,
  ChatStreamKind,
} from "@pi-harness/shared";
import { isChatStreamKind } from "@pi-harness/shared";

// ── URL builder ───────────────────────────────────────────────────────────────

/**
 * Builds the chat SSE proxy URL for a given thread.
 * The proxy route is at /api/chat/stream and the threadId is a query param
 * because the Next.js route path is fixed.
 */
export function buildChatStreamUrl(
  threadId: string,
  opts: { readonly afterSequence?: number } = {},
): string {
  const params = new URLSearchParams();
  params.set("threadId", threadId);
  if (opts.afterSequence !== undefined && opts.afterSequence > 0) {
    params.set("after", String(opts.afterSequence));
  }
  return `/api/chat/stream?${params.toString()}`;
}

// ── Parse + hydrate ───────────────────────────────────────────────────────────

/**
 * Safe JSON parse + kind guard. Returns null on invalid JSON or unknown kind.
 * Hydrates the ts field into a Date (matches live-event-client pattern).
 */
export function parseChatFrame(raw: string): ChatStreamFrame | null {
  const parsed = safeParseJson(raw);
  if (!isChatStreamFrame(parsed)) return null;
  return hydrateChatFrame(parsed);
}

function hydrateChatFrame(frame: ChatStreamFrame): ChatStreamFrame {
  return { ...frame, ts: toDate(frame.ts) };
}

function isChatStreamFrame(value: unknown): value is ChatStreamFrame {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["sequence"] === "number" &&
    typeof value["threadId"] === "string" &&
    "ts" in value &&
    "payload" in value &&
    isChatStreamKind(value["kind"])
  );
}

// ── Merge (dedupe + sort) ─────────────────────────────────────────────────────

/**
 * Merges two frame arrays: dedupes by id (later wins), sorts by sequence.
 * Mirrors mergeLiveEnvelopes from live-event-client.ts exactly.
 */
export function mergeChatFrames(
  initial: readonly ChatStreamFrame[],
  incoming: readonly ChatStreamFrame[],
): ChatStreamFrame[] {
  const byId = new Map<string, ChatStreamFrame>();
  for (const frame of initial) byId.set(frame.id, hydrateChatFrame(frame));
  for (const frame of incoming) byId.set(frame.id, hydrateChatFrame(frame));
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

// ── Pure reducer ──────────────────────────────────────────────────────────────

/**
 * Folds a sorted list of ChatStreamFrames into a ChatMessage.
 * Pure: does not mutate either argument; always returns a new ChatMessage.
 *
 * Frame ordering: frames are sorted by sequence before folding so out-of-order
 * delivery is handled. Idempotent under replay (EDGE-003): the same frame id
 * must be deduped upstream via mergeChatFrames before calling this.
 */
export function reduceChatFrames(
  message: ChatMessage,
  frames: readonly ChatStreamFrame[],
): ChatMessage {
  // Sort frames by sequence before folding
  const sorted = [...frames].sort((a, b) => a.sequence - b.sequence);

  let result = message;
  for (const frame of sorted) {
    result = applyFrame(result, frame);
  }
  return result;
}

function applyFrame(message: ChatMessage, frame: ChatStreamFrame): ChatMessage {
  const kind = frame.kind as ChatStreamKind;

  switch (kind) {
    case "chat.delta": {
      const payload = frame.payload as { messageId: string; text: string };
      return appendToPart(message, "text", payload.text);
    }

    case "chat.thinking": {
      const payload = frame.payload as { messageId: string; text: string };
      // EDGE-005: never create an empty thinking part
      if (!payload.text) return message;
      return appendToPart(message, "thinking", payload.text);
    }

    case "chat.tool_call": {
      const payload = frame.payload as {
        messageId: string;
        callId: string;
        tool: string;
        input: unknown;
      };
      // Idempotent: if this callId already exists, do not duplicate
      const existing = message.parts.find(
        (p) => p.kind === "tool" && p.callId === payload.callId,
      );
      if (existing) return message;
      const newPart: ChatMessagePart = {
        kind: "tool",
        callId: payload.callId,
        tool: payload.tool,
        input: payload.input,
        status: "running",
      };
      return { ...message, parts: [...message.parts, newPart] };
    }

    case "chat.tool_result": {
      const payload = frame.payload as {
        messageId: string;
        callId: string;
        tool: string;
        ok: boolean;
        output?: unknown;
      };
      const idx = message.parts.findIndex(
        (p) => p.kind === "tool" && p.callId === payload.callId,
      );
      if (idx === -1) {
        // EDGE-002: unknown callId — append a result-only part, never throw
        const resultPart: ChatMessagePart = {
          kind: "tool",
          callId: payload.callId,
          tool: payload.tool,
          input: undefined,
          status: payload.ok ? "ok" : "error",
          output: payload.output,
        };
        return { ...message, parts: [...message.parts, resultPart] };
      }
      const updated = message.parts.map((p, i) => {
        if (i !== idx) return p;
        return {
          ...p,
          status: payload.ok ? ("ok" as const) : ("error" as const),
          output: payload.output,
        };
      });
      return { ...message, parts: updated };
    }

    case "chat.turn_end": {
      const payload = frame.payload as {
        messageId: string;
        usage: { inputTokens: number; outputTokens: number; costUsd: number };
      };
      return { ...message, status: "complete", usage: payload.usage };
    }

    case "chat.stopped": {
      return { ...message, status: "stopped" };
    }

    case "chat.error": {
      const payload = frame.payload as { messageId: string; text: string };
      return { ...message, status: "error", error: payload.text };
    }

    default: {
      // Exhaustiveness guard — unknown future frames are ignored safely
      return message;
    }
  }
}

// ── Part-append helpers ───────────────────────────────────────────────────────

/**
 * Appends text to the trailing part of the given kind, or creates a new one.
 * Used for both text and thinking parts (same append-or-create logic).
 */
function appendToPart(
  message: ChatMessage,
  partKind: "text" | "thinking",
  text: string,
): ChatMessage {
  const parts = message.parts;
  const last = parts[parts.length - 1];

  if (last && last.kind === partKind) {
    // Append to existing trailing part
    const updated: ChatMessagePart = { ...last, text: last.text + text };
    return { ...message, parts: [...parts.slice(0, -1), updated] };
  }

  // Create new part
  const newPart: ChatMessagePart = { kind: partKind, text };
  return { ...message, parts: [...parts, newPart] };
}

// ── Small utilities ───────────────────────────────────────────────────────────

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value as string);
}
