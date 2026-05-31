/**
 * Tests for chat-client.ts — the pure reducer and URL/parse helpers.
 * TDD: tests written first; implementation follows (RED → GREEN → REFACTOR).
 *
 * REQ-011, REQ-013, REQ-014, REQ-022, REQ-023, REQ-050, REQ-051, REQ-052
 * EDGE-002, EDGE-003, EDGE-005
 */
import { describe, it, expect } from "vitest";
import type {
  ChatMessage,
  ChatStreamFrame,
  ChatStreamKind,
  ChatStreamPayloadByKind,
} from "@pi-harness/shared";
import {
  buildChatStreamUrl,
  parseChatFrame,
  mergeChatFrames,
  reduceChatFrames,
} from "@/lib/chat/chat-client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function frame<K extends ChatStreamKind>(
  kind: K,
  payload: ChatStreamPayloadByKind[K],
  sequence = 1,
  id = `frame-${sequence}`,
): ChatStreamFrame<K> {
  return {
    id,
    sequence,
    ts: new Date("2026-05-30T10:00:00Z"),
    threadId: "thread-1",
    kind,
    payload,
  };
}

const BASE_MSG: ChatMessage = {
  id: "msg-1",
  threadId: "thread-1",
  role: "assistant",
  createdAt: new Date("2026-05-30T10:00:00Z"),
  parts: [],
  status: "streaming",
};

// ── buildChatStreamUrl ────────────────────────────────────────────────────────

describe("buildChatStreamUrl", () => {
  it("returns the chat proxy URL for a thread id (REQ-011)", () => {
    expect(buildChatStreamUrl("thread-42")).toBe(
      "/api/chat/stream?threadId=thread-42",
    );
  });

  it("appends after= param when afterSequence > 0 (REQ-014)", () => {
    expect(buildChatStreamUrl("thread-1", { afterSequence: 7 })).toBe(
      "/api/chat/stream?threadId=thread-1&after=7",
    );
  });

  it("omits after= when afterSequence is 0 or missing", () => {
    expect(buildChatStreamUrl("thread-1", { afterSequence: 0 })).toBe(
      "/api/chat/stream?threadId=thread-1",
    );
    expect(buildChatStreamUrl("thread-1")).toBe(
      "/api/chat/stream?threadId=thread-1",
    );
  });
});

// ── parseChatFrame ────────────────────────────────────────────────────────────

describe("parseChatFrame", () => {
  it("parses a valid chat.delta frame", () => {
    const raw = JSON.stringify(
      frame("chat.delta", { messageId: "msg-1", text: "Hello" }),
    );
    const result = parseChatFrame(raw);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("chat.delta");
    expect(result?.ts).toBeInstanceOf(Date);
  });

  it("returns null for malformed JSON", () => {
    expect(parseChatFrame("{bad")).toBeNull();
  });

  it("returns null for unknown event kind", () => {
    const raw = JSON.stringify({
      id: "f-1",
      sequence: 1,
      ts: "2026-05-30T10:00:00Z",
      threadId: "thread-1",
      kind: "live.unknown",
      payload: {},
    });
    expect(parseChatFrame(raw)).toBeNull();
  });

  it("hydrates ts string into a Date instance", () => {
    const raw = JSON.stringify({
      id: "f-1",
      sequence: 1,
      ts: "2026-05-30T10:00:00.000Z",
      threadId: "thread-1",
      kind: "chat.delta",
      payload: { messageId: "msg-1", text: "hi" },
    });
    const result = parseChatFrame(raw);
    expect(result?.ts).toBeInstanceOf(Date);
  });
});

// ── mergeChatFrames ───────────────────────────────────────────────────────────

describe("mergeChatFrames", () => {
  it("dedupes frames by id and sorts by sequence (EDGE-003)", () => {
    const f1 = frame("chat.delta", { messageId: "m", text: "A" }, 2, "f2");
    const f2 = frame("chat.delta", { messageId: "m", text: "B" }, 1, "f1");

    const merged = mergeChatFrames([f1], [f1, f2]);
    expect(merged.map((f) => f.sequence)).toEqual([1, 2]);
    expect(merged).toHaveLength(2);
  });

  it("second write wins for same id", () => {
    const f1 = frame("chat.delta", { messageId: "m", text: "original" }, 1, "dup");
    const f2 = frame("chat.delta", { messageId: "m", text: "updated" }, 1, "dup");

    const merged = mergeChatFrames([f1], [f2]);
    expect(merged).toHaveLength(1);
    expect((merged[0]?.payload as ChatStreamPayloadByKind["chat.delta"]).text).toBe("updated");
  });
});

// ── reduceChatFrames ──────────────────────────────────────────────────────────

describe("reduceChatFrames — chat.delta", () => {
  it("appends text to a trailing text part (REQ-013)", () => {
    const f = frame("chat.delta", { messageId: "msg-1", text: " world" });
    const msg: ChatMessage = {
      ...BASE_MSG,
      parts: [{ kind: "text", text: "Hello" }],
    };
    const result = reduceChatFrames(msg, [f]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ kind: "text", text: "Hello world" });
  });

  it("creates a new text part when parts is empty", () => {
    const f = frame("chat.delta", { messageId: "msg-1", text: "Hi" });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ kind: "text", text: "Hi" });
  });

  it("creates a new text part when trailing part is not text", () => {
    const msg: ChatMessage = {
      ...BASE_MSG,
      parts: [
        {
          kind: "tool",
          callId: "c1",
          tool: "grep",
          input: "query",
          status: "running",
        },
      ],
    };
    const f = frame("chat.delta", { messageId: "msg-1", text: " answer" });
    const result = reduceChatFrames(msg, [f]);
    expect(result.parts).toHaveLength(2);
    expect(result.parts[1]).toMatchObject({ kind: "text", text: " answer" });
  });
});

describe("reduceChatFrames — chat.thinking", () => {
  it("appends text to a trailing thinking part", () => {
    const msg: ChatMessage = {
      ...BASE_MSG,
      parts: [{ kind: "thinking", text: "Step 1." }],
    };
    const f = frame("chat.thinking", { messageId: "msg-1", text: " Step 2." });
    const result = reduceChatFrames(msg, [f]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ kind: "thinking", text: "Step 1. Step 2." });
  });

  it("creates a thinking part when trailing part is not thinking", () => {
    const f = frame("chat.thinking", { messageId: "msg-1", text: "Reasoning..." });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ kind: "thinking", text: "Reasoning..." });
  });

  it("EDGE-005: never creates an empty thinking part", () => {
    const f = frame("chat.thinking", { messageId: "msg-1", text: "" });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.parts.filter((p) => p.kind === "thinking")).toHaveLength(0);
  });
});

describe("reduceChatFrames — chat.tool_call", () => {
  it("pushes a tool part with status=running (REQ-022)", () => {
    const f = frame("chat.tool_call", {
      messageId: "msg-1",
      callId: "call-1",
      tool: "grep",
      input: { pattern: "foo" },
    });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      kind: "tool",
      callId: "call-1",
      tool: "grep",
      status: "running",
    });
  });

  it("does not duplicate a tool part if the same callId is already present", () => {
    const existingPart = {
      kind: "tool" as const,
      callId: "call-1",
      tool: "grep",
      input: { pattern: "foo" },
      status: "running" as const,
    };
    const msg: ChatMessage = { ...BASE_MSG, parts: [existingPart] };
    const f = frame("chat.tool_call", {
      messageId: "msg-1",
      callId: "call-1",
      tool: "grep",
      input: { pattern: "foo" },
    });
    const result = reduceChatFrames(msg, [f]);
    expect(result.parts.filter((p) => p.kind === "tool")).toHaveLength(1);
  });
});

describe("reduceChatFrames — chat.tool_result", () => {
  it("sets matching tool part to ok + output (REQ-023)", () => {
    const msg: ChatMessage = {
      ...BASE_MSG,
      parts: [
        {
          kind: "tool",
          callId: "call-1",
          tool: "grep",
          input: "pattern",
          status: "running",
        },
      ],
    };
    const f = frame("chat.tool_result", {
      messageId: "msg-1",
      callId: "call-1",
      tool: "grep",
      ok: true,
      output: "3 matches",
    });
    const result = reduceChatFrames(msg, [f]);
    expect(result.parts[0]).toMatchObject({ status: "ok", output: "3 matches" });
  });

  it("sets matching tool part to error when ok=false", () => {
    const msg: ChatMessage = {
      ...BASE_MSG,
      parts: [
        {
          kind: "tool",
          callId: "c-err",
          tool: "bash",
          input: "pnpm test",
          status: "running",
        },
      ],
    };
    const f = frame("chat.tool_result", {
      messageId: "msg-1",
      callId: "c-err",
      tool: "bash",
      ok: false,
      output: "exit 1",
    });
    const result = reduceChatFrames(msg, [f]);
    expect(result.parts[0]).toMatchObject({ status: "error", output: "exit 1" });
  });

  it("EDGE-002: appends a result-only part when callId has no match — never throws", () => {
    const f = frame("chat.tool_result", {
      messageId: "msg-1",
      callId: "unknown-call",
      tool: "bash",
      ok: true,
      output: "result",
    });
    expect(() => reduceChatFrames(BASE_MSG, [f])).not.toThrow();
    const result = reduceChatFrames(BASE_MSG, [f]);
    const tool = result.parts.find((p) => p.kind === "tool");
    expect(tool).toMatchObject({ callId: "unknown-call", status: "ok" });
  });
});

describe("reduceChatFrames — chat.turn_end", () => {
  it("sets status=complete and usage (REQ-050)", () => {
    const f = frame("chat.turn_end", {
      messageId: "msg-1",
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001 },
    });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.status).toBe("complete");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.001 });
  });
});

describe("reduceChatFrames — chat.stopped", () => {
  it("sets status=stopped (REQ-051)", () => {
    const f = frame("chat.stopped", { messageId: "msg-1" });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.status).toBe("stopped");
  });
});

describe("reduceChatFrames — chat.error", () => {
  it("sets status=error and error text (REQ-052)", () => {
    const f = frame("chat.error", {
      messageId: "msg-1",
      text: "orchestrator unreachable",
    });
    const result = reduceChatFrames(BASE_MSG, [f]);
    expect(result.status).toBe("error");
    expect(result.error).toBe("orchestrator unreachable");
  });
});

describe("reduceChatFrames — idempotency (EDGE-003)", () => {
  it("applying the same delta frame twice yields the same result as once", () => {
    const f = frame("chat.delta", { messageId: "msg-1", text: "Hi" });
    const once = reduceChatFrames(BASE_MSG, [f]);
    // Second call merges deduplicated frames (same id), so result must be identical
    const merged = mergeChatFrames([f], [f]);
    const twice = reduceChatFrames(BASE_MSG, merged);
    expect(twice.parts).toEqual(once.parts);
  });

  it("applying the same tool_result twice updates the same part once (EDGE-003)", () => {
    const toolMsg: ChatMessage = {
      ...BASE_MSG,
      parts: [
        {
          kind: "tool",
          callId: "c1",
          tool: "grep",
          input: "q",
          status: "running",
        },
      ],
    };
    const f = frame("chat.tool_result", {
      messageId: "msg-1",
      callId: "c1",
      tool: "grep",
      ok: true,
      output: "found",
    });
    const merged = mergeChatFrames([f], [f]);
    const result = reduceChatFrames(toolMsg, merged);
    expect(result.parts.filter((p) => p.kind === "tool")).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ status: "ok" });
  });
});

describe("reduceChatFrames — out-of-order frames", () => {
  it("sorts frames by sequence before folding", () => {
    const f2 = frame("chat.delta", { messageId: "msg-1", text: "World" }, 2, "f2");
    const f1 = frame("chat.delta", { messageId: "msg-1", text: "Hello " }, 1, "f1");
    // Pass out of order
    const result = reduceChatFrames(BASE_MSG, [f2, f1]);
    expect(result.parts[0]).toMatchObject({ kind: "text", text: "Hello World" });
  });
});

describe("reduceChatFrames — multiple frame kinds in sequence", () => {
  it("folds thinking then delta into correct part order", () => {
    const fThink = frame("chat.thinking", { messageId: "msg-1", text: "Reasoning..." }, 1, "f1");
    const fDelta = frame("chat.delta", { messageId: "msg-1", text: "Answer here." }, 2, "f2");
    const result = reduceChatFrames(BASE_MSG, [fThink, fDelta]);
    expect(result.parts[0]).toMatchObject({ kind: "thinking", text: "Reasoning..." });
    expect(result.parts[1]).toMatchObject({ kind: "text", text: "Answer here." });
  });

  it("folds tool_call then tool_result in sequence", () => {
    const fCall = frame(
      "chat.tool_call",
      { messageId: "msg-1", callId: "c1", tool: "grep", input: "q" },
      1,
      "f1",
    );
    const fResult = frame(
      "chat.tool_result",
      { messageId: "msg-1", callId: "c1", tool: "grep", ok: true, output: "hits" },
      2,
      "f2",
    );
    const result = reduceChatFrames(BASE_MSG, [fCall, fResult]);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ kind: "tool", callId: "c1", status: "ok" });
  });
});
