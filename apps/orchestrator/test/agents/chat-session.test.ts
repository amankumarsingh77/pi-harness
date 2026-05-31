/**
 * Tests for the runChatTurn driver.
 *
 * The fake SDK boundary emits scripted PiBridgeEvent sequences without
 * touching any live model. All tests use the injectable `createAgentSession`
 * parameter — the live SDK is NEVER called.
 *
 * REQ-010, REQ-011, REQ-013, REQ-014, REQ-031, REQ-032, REQ-050, REQ-052
 * EDGE-002, EDGE-004
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentSession, AgentSessionOptions, PiBridgeEvent } from "@pi-harness/pi-bridge";
import type { ChatModelSelection, ChatStreamFrame } from "@pi-harness/shared";
import { runChatTurn, type CreateAgentSessionFn } from "../../src/agents/chat-session.js";
import { ChatSessionStore } from "../../src/adapters/chat-store.js";

// ── Test setup ────────────────────────────────────────────────────────────────

const MODEL: ChatModelSelection = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  thinkingLevel: "off",
};

let stateDir: string;
let store: ChatSessionStore;
let cwd: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "chat-session-"));
  cwd = stateDir;
  store = new ChatSessionStore({ stateDir });
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

// ── Fake session builder ───────────────────────────────────────────────────────

type FakeSessionState = {
  promptCalled: boolean;
  abortCalled: boolean;
  closeCalled: boolean;
  onEvent: ((e: PiBridgeEvent) => void) | null;
};

function makeFakeCreateSession(
  script: PiBridgeEvent[],
  opts?: { throwAuthError?: boolean; resolveUsage?: { inputTokens: number; outputTokens: number; costUsd: number } },
): { createAgentSession: CreateAgentSessionFn; state: FakeSessionState } {
  const state: FakeSessionState = {
    promptCalled: false,
    abortCalled: false,
    closeCalled: false,
    onEvent: null,
  };

  const createAgentSession: CreateAgentSessionFn = async (sessionOpts: AgentSessionOptions) => {
    if (opts?.throwAuthError) {
      const { AuthError } = await import("@pi-harness/pi-bridge");
      throw new AuthError("missing API key for anthropic");
    }

    state.onEvent = sessionOpts.onEvent;

    const usage = opts?.resolveUsage ?? { inputTokens: 10, outputTokens: 20, costUsd: 0.001 };

    const session: AgentSession = {
      async prompt(_text: string) {
        state.promptCalled = true;
        // Fire events synchronously after a tick so the abort listener is registered
        await Promise.resolve();
        for (const event of script) {
          state.onEvent?.(event);
        }
        return usage;
      },
      async abort() {
        state.abortCalled = true;
      },
      async close() {
        state.closeCalled = true;
      },
    };

    return session;
  };

  return { createAgentSession, state };
}

// ── Helper: collect all frames for a thread ───────────────────────────────────

async function waitForFrames(
  threadStore: ChatSessionStore,
  threadId: string,
  count: number,
  timeoutMs = 2000,
): Promise<ChatStreamFrame[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frames = await threadStore.listFramesAfter(threadId, 0);
    if (frames.length >= count) return frames;
    await new Promise((r) => setTimeout(r, 10));
  }
  return threadStore.listFramesAfter(threadId, 0);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runChatTurn — happy path event mapping (REQ-011, REQ-013)", () => {
  it("maps message_delta → chat.delta frames", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      { kind: "message_delta", text: "Hello" },
      { kind: "message_delta", text: " world" },
      { kind: "turn_end", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "hi",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const deltaFrames = frames.filter((f) => f.kind === "chat.delta");
    expect(deltaFrames).toHaveLength(2);
    expect((deltaFrames[0].payload as { text: string }).text).toBe("Hello");
    expect((deltaFrames[1].payload as { text: string }).text).toBe(" world");
  });

  it("maps tool_call → chat.tool_call frame", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const callId = "call-123";
    const events: PiBridgeEvent[] = [
      { kind: "tool_call", callId, tool: "read_file", input: { path: "foo.ts" } },
      { kind: "tool_result", callId, tool: "read_file", ok: true, output: "content" },
      { kind: "turn_end", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "read it",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const toolCallFrame = frames.find((f) => f.kind === "chat.tool_call");
    expect(toolCallFrame).toBeDefined();
    const p = toolCallFrame!.payload as { callId: string; tool: string };
    expect(p.callId).toBe(callId);
    expect(p.tool).toBe("read_file");
  });

  it("maps tool_result → chat.tool_result frame", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const callId = "call-456";
    const events: PiBridgeEvent[] = [
      { kind: "tool_call", callId, tool: "bash", input: { cmd: "ls" } },
      { kind: "tool_result", callId, tool: "bash", ok: true, output: "file.ts" },
      { kind: "turn_end", usage: { inputTokens: 5, outputTokens: 3, costUsd: 0 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "list files",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const resultFrame = frames.find((f) => f.kind === "chat.tool_result");
    expect(resultFrame).toBeDefined();
    const p = resultFrame!.payload as { callId: string; ok: boolean; output: unknown };
    expect(p.callId).toBe(callId);
    expect(p.ok).toBe(true);
    expect(p.output).toBe("file.ts");
  });

  it("maps turn_end → chat.turn_end frame with usage (REQ-013)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      { kind: "message_delta", text: "Done" },
      { kind: "turn_end", usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.005 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "do it",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const turnEndFrame = frames.find((f) => f.kind === "chat.turn_end");
    expect(turnEndFrame).toBeDefined();
    const p = turnEndFrame!.payload as { usage: { inputTokens: number } };
    expect(p.usage.inputTokens).toBe(100);
  });

  it("finalizes assistant message to 'complete' with usage after turn_end (REQ-013)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      { kind: "message_delta", text: "result" },
      { kind: "turn_end", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.002 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "do it",
      store,
      createAgentSession,
    });

    const { messages } = await store.getThread(thread.id);
    const msg = messages.find((m) => m.id === assistantMsg.id);
    // The driver re-appends a finalized message with status complete
    // getThread returns the latest snapshot, so the last append with this id wins
    // We check for a complete message with usage
    const finalMsg = messages.find((m) => m.status === "complete" && m.usage !== undefined);
    expect(finalMsg).toBeDefined();
    expect(finalMsg!.usage?.inputTokens).toBe(10);
    expect(finalMsg!.usage?.outputTokens).toBe(20);
  });

  it("does not emit empty thinking (EDGE-005)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    // log events that simulate empty thinking — should not produce chat.thinking frames
    const events: PiBridgeEvent[] = [
      { kind: "log", level: "info", text: "" },
      { kind: "message_delta", text: "actual content" },
      { kind: "turn_end", usage: { inputTokens: 5, outputTokens: 5, costUsd: 0 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "hi",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const thinkingFrames = frames.filter((f) => f.kind === "chat.thinking");
    expect(thinkingFrames).toHaveLength(0);
  });

  it("maps thinking_delta → chat.thinking frame and persists a thinking part", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      { kind: "thinking_delta", text: "weighing options" },
      { kind: "thinking_delta", text: "" }, // dropped — EDGE-005
      { kind: "message_delta", text: "the answer" },
      { kind: "turn_end", usage: { inputTokens: 5, outputTokens: 5, costUsd: 0 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);
    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "hi",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const thinkingFrames = frames.filter((f) => f.kind === "chat.thinking");
    expect(thinkingFrames).toHaveLength(1);
    expect((thinkingFrames[0].payload as { text: string }).text).toBe("weighing options");

    // The finalized message keeps the thinking part ahead of the text part.
    const { messages } = await store.getThread(thread.id);
    const finalized = messages.find((m) => m.id === assistantMsg.id);
    const kinds = finalized?.parts.map((p) => p.kind);
    expect(kinds).toEqual(["thinking", "text"]);
  });

  it("frames are ordered with monotonically increasing sequence (REQ-014)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      { kind: "message_delta", text: "a" },
      { kind: "message_delta", text: "b" },
      { kind: "message_delta", text: "c" },
      { kind: "turn_end", usage: { inputTokens: 1, outputTokens: 3, costUsd: 0 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "abc",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const seqs = frames.map((f) => f.sequence);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });
});

// ── Abort (REQ-031/032) ───────────────────────────────────────────────────────

describe("abort (REQ-031/032)", () => {
  it("publishes chat.stopped when signal is aborted mid-stream", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const controller = new AbortController();

    // Script: delta, then abort triggers before turn_end
    let capturedOnEvent: ((e: PiBridgeEvent) => void) | null = null;
    const createAgentSession: CreateAgentSessionFn = async (opts: AgentSessionOptions) => {
      capturedOnEvent = opts.onEvent;
      return {
        async prompt(_text: string) {
          // Emit one delta, then trigger abort
          capturedOnEvent?.({ kind: "message_delta", text: "partial" });
          controller.abort();
          // Don't emit turn_end — simulates aborted mid-stream
          return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
        },
        async abort() {},
        async close() {},
      };
    };

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "go",
      store,
      createAgentSession,
      signal: controller.signal,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const stoppedFrame = frames.find((f) => f.kind === "chat.stopped");
    expect(stoppedFrame).toBeDefined();
    expect((stoppedFrame!.payload as { messageId: string }).messageId).toBe(assistantMsg.id);
  });

  it("preserves partial text in message status=stopped (REQ-032)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const controller = new AbortController();

    let capturedOnEvent: ((e: PiBridgeEvent) => void) | null = null;
    const createAgentSession: CreateAgentSessionFn = async (opts: AgentSessionOptions) => {
      capturedOnEvent = opts.onEvent;
      return {
        async prompt(_text: string) {
          capturedOnEvent?.({ kind: "message_delta", text: "partial response" });
          controller.abort();
          return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
        },
        async abort() {},
        async close() {},
      };
    };

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "go",
      store,
      createAgentSession,
      signal: controller.signal,
    });

    const { messages } = await store.getThread(thread.id);
    const stoppedMsg = messages.find((m) => m.status === "stopped");
    expect(stoppedMsg).toBeDefined();
    // Partial text should be retained in parts
    const textParts = stoppedMsg!.parts.filter((p) => p.kind === "text");
    expect(textParts.length).toBeGreaterThan(0);
  });

  it("no frames emitted after abort (REQ-031)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const controller = new AbortController();

    let capturedOnEvent: ((e: PiBridgeEvent) => void) | null = null;
    const createAgentSession: CreateAgentSessionFn = async (opts: AgentSessionOptions) => {
      capturedOnEvent = opts.onEvent;
      return {
        async prompt(_text: string) {
          capturedOnEvent?.({ kind: "message_delta", text: "part1" });
          controller.abort();
          // These should be suppressed after abort:
          capturedOnEvent?.({ kind: "message_delta", text: "part2_should_not_appear" });
          return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
        },
        async abort() {},
        async close() {},
      };
    };

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "go",
      store,
      createAgentSession,
      signal: controller.signal,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const deltaFrames = frames.filter((f) => f.kind === "chat.delta");
    // Only the first delta before abort should appear
    expect(deltaFrames.every((f) => (f.payload as { text: string }).text !== "part2_should_not_appear")).toBe(true);
  });
});

// ── Stop-after-turn_end is a no-op (EDGE-004) ─────────────────────────────────

describe("stop after turn_end (EDGE-004)", () => {
  it("aborting after turn_end produces no error and does not add another stopped frame", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const controller = new AbortController();

    const events: PiBridgeEvent[] = [
      { kind: "message_delta", text: "done" },
      { kind: "turn_end", usage: { inputTokens: 5, outputTokens: 5, costUsd: 0 } },
    ];

    let capturedOnEvent: ((e: PiBridgeEvent) => void) | null = null;
    const createAgentSession: CreateAgentSessionFn = async (opts: AgentSessionOptions) => {
      capturedOnEvent = opts.onEvent;
      return {
        async prompt(_text: string) {
          for (const e of events) capturedOnEvent?.(e);
          // Abort AFTER turn_end — should be a no-op
          controller.abort();
          return { inputTokens: 5, outputTokens: 5, costUsd: 0 };
        },
        async abort() {},
        async close() {},
      };
    };

    // Should not throw
    await expect(
      runChatTurn({
        cwd,
        thread,
        assistantMessageId: assistantMsg.id,
        promptText: "go",
        store,
        createAgentSession,
        signal: controller.signal,
      }),
    ).resolves.not.toThrow();

    const frames = await store.listFramesAfter(thread.id, 0);
    const stoppedFrames = frames.filter((f) => f.kind === "chat.stopped");
    // No stopped frame after a completed turn
    expect(stoppedFrames).toHaveLength(0);
  });
});

// ── Unknown callId in tool_result (EDGE-002) ──────────────────────────────────

describe("tool_result with unknown callId (EDGE-002)", () => {
  it("does not throw when tool_result has no prior tool_call", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      // No prior tool_call for this callId
      { kind: "tool_result", callId: "unknown-call-id", tool: "bash", ok: true, output: "ok" },
      { kind: "turn_end", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await expect(
      runChatTurn({
        cwd,
        thread,
        assistantMessageId: assistantMsg.id,
        promptText: "run",
        store,
        createAgentSession,
      }),
    ).resolves.not.toThrow();
  });
});

// ── AuthError (REQ-052) ────────────────────────────────────────────────────────

describe("AuthError from createAgentSession (REQ-052)", () => {
  it("emits a single chat.error frame and marks message status error", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const { createAgentSession } = makeFakeCreateSession([], { throwAuthError: true });

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "hi",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const errorFrames = frames.filter((f) => f.kind === "chat.error");
    expect(errorFrames).toHaveLength(1);
    // Error text should name the provider
    const text = (errorFrames[0].payload as { text: string }).text;
    expect(text).toContain("anthropic");

    const { messages } = await store.getThread(thread.id);
    const errorMsg = messages.find((m) => m.status === "error");
    expect(errorMsg).toBeDefined();
  });

  it("does not leave message in streaming state after AuthError (REQ-052)", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const { createAgentSession } = makeFakeCreateSession([], { throwAuthError: true });

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "hi",
      store,
      createAgentSession,
    });

    const { messages } = await store.getThread(thread.id);
    const stillStreaming = messages.filter((m) => m.status === "streaming");
    expect(stillStreaming).toHaveLength(0);
  });
});

// ── error event from session ────────────────────────────────────────────────

describe("error event from session", () => {
  it("maps error → chat.error frame and finalizes message status error", async () => {
    const thread = await store.createThread({ model: MODEL });
    const assistantMsg = await store.appendMessage(thread.id, {
      role: "assistant",
      parts: [],
      status: "streaming",
    });

    const events: PiBridgeEvent[] = [
      { kind: "message_delta", text: "partial" },
      { kind: "error", text: "something went wrong" },
    ];

    const { createAgentSession } = makeFakeCreateSession(events);

    await runChatTurn({
      cwd,
      thread,
      assistantMessageId: assistantMsg.id,
      promptText: "hi",
      store,
      createAgentSession,
    });

    const frames = await store.listFramesAfter(thread.id, 0);
    const errorFrames = frames.filter((f) => f.kind === "chat.error");
    expect(errorFrames.length).toBeGreaterThan(0);
    expect((errorFrames[0].payload as { text: string }).text).toBe("something went wrong");

    const { messages } = await store.getThread(thread.id);
    const errorMsg = messages.find((m) => m.status === "error");
    expect(errorMsg).toBeDefined();
  });
});
