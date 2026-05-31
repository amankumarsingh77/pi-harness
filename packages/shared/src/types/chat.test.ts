import { describe, it, expect } from "vitest";
import type {
  ChatStreamFrame,
  ChatStreamKind,
  ChatMessagePart,
  ChatThinkingLevel,
} from "./chat.js";
import {
  CHAT_THINKING_LEVELS,
  isChatStreamKind,
} from "./chat.js";

// ── Discriminator narrowing tests ────────────────────────────────────────────
// These tests verify both compile-time narrowing (TypeScript) and runtime
// behavior of the ChatStreamFrame union, mirroring the pattern in event.test.ts.
// We use ChatStreamFrame<K> typed variables so tsc can narrow the payload type.

const baseFrame = {
  id: "f1",
  sequence: 1,
  ts: new Date(0),
  threadId: "thread-1",
};

describe("ChatStreamFrame discriminator narrowing", () => {
  it("chat.delta narrows to delta payload", () => {
    const frame: ChatStreamFrame<"chat.delta"> = {
      ...baseFrame,
      kind: "chat.delta",
      payload: { messageId: "msg-1", text: "Hello" },
    };
    expect(frame.payload.text).toBe("Hello");
    expect(frame.payload.messageId).toBe("msg-1");
  });

  it("chat.thinking narrows to thinking payload", () => {
    const frame: ChatStreamFrame<"chat.thinking"> = {
      ...baseFrame,
      kind: "chat.thinking",
      payload: { messageId: "msg-1", text: "Let me think..." },
    };
    expect(frame.payload.text).toBe("Let me think...");
  });

  it("chat.tool_call narrows to tool_call payload", () => {
    const frame: ChatStreamFrame<"chat.tool_call"> = {
      ...baseFrame,
      kind: "chat.tool_call",
      payload: {
        messageId: "msg-1",
        callId: "call-1",
        tool: "read_file",
        input: { path: "/src/index.ts" },
      },
    };
    expect(frame.payload.tool).toBe("read_file");
    expect(frame.payload.callId).toBe("call-1");
    expect(frame.payload.input).toEqual({ path: "/src/index.ts" });
  });

  it("chat.tool_result narrows to tool_result payload with output", () => {
    const frame: ChatStreamFrame<"chat.tool_result"> = {
      ...baseFrame,
      kind: "chat.tool_result",
      payload: {
        messageId: "msg-1",
        callId: "call-1",
        tool: "read_file",
        ok: true,
        output: "file contents",
      },
    };
    expect(frame.payload.ok).toBe(true);
    expect(frame.payload.output).toBe("file contents");
  });

  it("chat.tool_result without output is valid", () => {
    const frame: ChatStreamFrame<"chat.tool_result"> = {
      ...baseFrame,
      kind: "chat.tool_result",
      payload: {
        messageId: "msg-1",
        callId: "call-1",
        tool: "write_file",
        ok: false,
      },
    };
    expect(frame.payload.ok).toBe(false);
    expect(frame.payload.output).toBeUndefined();
  });

  it("chat.turn_end narrows to turn_end payload with usage", () => {
    const frame: ChatStreamFrame<"chat.turn_end"> = {
      ...baseFrame,
      kind: "chat.turn_end",
      payload: {
        messageId: "msg-1",
        usage: { inputTokens: 100, outputTokens: 200, costUsd: 0.05 },
      },
    };
    expect(frame.payload.usage.inputTokens).toBe(100);
    expect(frame.payload.usage.outputTokens).toBe(200);
    expect(frame.payload.usage.costUsd).toBe(0.05);
  });

  it("chat.stopped narrows to stopped payload", () => {
    const frame: ChatStreamFrame<"chat.stopped"> = {
      ...baseFrame,
      kind: "chat.stopped",
      payload: { messageId: "msg-1" },
    };
    expect(frame.payload.messageId).toBe("msg-1");
  });

  it("chat.error narrows to error payload", () => {
    const frame: ChatStreamFrame<"chat.error"> = {
      ...baseFrame,
      kind: "chat.error",
      payload: { messageId: "msg-1", text: "Auth failure: no API key" },
    };
    expect(frame.payload.text).toContain("Auth failure");
  });
});

// ── Runtime kind-narrowing via if-branches (unparameterised frame) ────────────
// Also exercises the discriminator at runtime without parameterised generic.

describe("ChatStreamFrame runtime kind narrowing (union branch)", () => {
  it("chat.delta: runtime branch resolves payload correctly", () => {
    const frame: ChatStreamFrame = {
      ...baseFrame,
      kind: "chat.delta",
      payload: { messageId: "msg-2", text: "world" },
    };
    if (frame.kind === "chat.delta") {
      // narrowed: payload is ChatStreamPayloadByKind["chat.delta"]
      expect((frame.payload as { text: string }).text).toBe("world");
    } else {
      expect.fail("expected chat.delta");
    }
  });

  it("chat.error: runtime branch resolves payload correctly", () => {
    const frame: ChatStreamFrame = {
      ...baseFrame,
      kind: "chat.error",
      payload: { messageId: "msg-err", text: "something went wrong" },
    };
    if (frame.kind === "chat.error") {
      expect((frame.payload as { text: string }).text).toBe("something went wrong");
    } else {
      expect.fail("expected chat.error");
    }
  });
});

// ── Generic parameter narrowing ───────────────────────────────────────────────

describe("ChatStreamFrame<K> generic parameter", () => {
  it("ChatStreamFrame<'chat.delta'> pins payload to delta payload type", () => {
    const frame: ChatStreamFrame<"chat.delta"> = {
      ...baseFrame,
      kind: "chat.delta",
      payload: { messageId: "msg-2", text: "world" },
    };
    expect(frame.payload.text).toBe("world");
  });

  it("ChatStreamFrame<'chat.turn_end'> pins payload to turn_end payload type", () => {
    const frame: ChatStreamFrame<"chat.turn_end"> = {
      ...baseFrame,
      kind: "chat.turn_end",
      payload: { messageId: "msg-2", usage: { inputTokens: 5, outputTokens: 10, costUsd: 0.001 } },
    };
    expect(frame.payload.usage.costUsd).toBe(0.001);
  });
});

// ── isChatStreamKind runtime guard ────────────────────────────────────────────

describe("isChatStreamKind runtime guard", () => {
  it("accepts every key in ChatStreamPayloadByKind", () => {
    const validKinds: ChatStreamKind[] = [
      "chat.delta",
      "chat.thinking",
      "chat.tool_call",
      "chat.tool_result",
      "chat.turn_end",
      "chat.stopped",
      "chat.error",
    ];
    for (const kind of validKinds) {
      expect(isChatStreamKind(kind)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isChatStreamKind("chat.unknown")).toBe(false);
    expect(isChatStreamKind("delta")).toBe(false);
    expect(isChatStreamKind("")).toBe(false);
    expect(isChatStreamKind("agent.event")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isChatStreamKind(42)).toBe(false);
    expect(isChatStreamKind(null)).toBe(false);
    expect(isChatStreamKind(undefined)).toBe(false);
    expect(isChatStreamKind({ kind: "chat.delta" })).toBe(false);
  });
});

// ── CHAT_THINKING_LEVELS exhaustiveness ───────────────────────────────────────

describe("CHAT_THINKING_LEVELS const array", () => {
  it("contains exactly the four thinking levels", () => {
    expect(CHAT_THINKING_LEVELS).toEqual(["off", "low", "medium", "high"]);
  });

  it("each element is a valid ChatThinkingLevel (exhaustiveness check)", () => {
    // This assignment proves the array covers the full union at compile time.
    const levels: readonly ChatThinkingLevel[] = CHAT_THINKING_LEVELS;
    expect(levels).toHaveLength(4);
  });
});

// ── ChatMessagePart tool variant status round-trip ────────────────────────────

describe("ChatMessagePart tool variant", () => {
  it("round-trips status: running", () => {
    const part: ChatMessagePart = {
      kind: "tool",
      callId: "call-1",
      tool: "read_file",
      input: { path: "/foo.ts" },
      status: "running",
    };
    if (part.kind === "tool") {
      expect(part.status).toBe("running");
      expect(part.output).toBeUndefined();
    } else {
      expect.fail("expected tool part");
    }
  });

  it("round-trips status: ok with output", () => {
    const part: ChatMessagePart = {
      kind: "tool",
      callId: "call-1",
      tool: "read_file",
      input: { path: "/foo.ts" },
      status: "ok",
      output: "file content here",
    };
    if (part.kind === "tool") {
      expect(part.status).toBe("ok");
      expect(part.output).toBe("file content here");
    } else {
      expect.fail("expected tool part");
    }
  });

  it("round-trips status: error", () => {
    const part: ChatMessagePart = {
      kind: "tool",
      callId: "call-1",
      tool: "read_file",
      input: {},
      status: "error",
      output: "ENOENT: no such file",
    };
    if (part.kind === "tool") {
      expect(part.status).toBe("error");
    } else {
      expect.fail("expected tool part");
    }
  });

  it("text part discriminates from tool part", () => {
    const part: ChatMessagePart = { kind: "text", text: "Hello world" };
    if (part.kind === "text") {
      expect(part.text).toBe("Hello world");
    } else {
      expect.fail("expected text part");
    }
  });

  it("thinking part discriminates from tool and text parts", () => {
    const part: ChatMessagePart = { kind: "thinking", text: "Reasoning..." };
    if (part.kind === "thinking") {
      expect(part.text).toBe("Reasoning...");
    } else {
      expect.fail("expected thinking part");
    }
  });
});
