/**
 * Tests for use-chat-stream.ts — EventSource lifecycle hook.
 * TDD: tests written first; implementation follows (RED → GREEN → REFACTOR).
 *
 * REQ-011, REQ-014, REQ-050, REQ-051, REQ-052
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatStream } from "@/lib/chat/use-chat-stream";

// ── MockEventSource ───────────────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate async open
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }

  close(): void {
    this.closed = true;
  }
}

function makeFrame(
  kind: string,
  payload: Record<string, unknown>,
  sequence = 1,
): string {
  return JSON.stringify({
    id: `frame-${sequence}`,
    sequence,
    ts: "2026-05-30T10:00:00.000Z",
    threadId: "thread-1",
    kind,
    payload: { messageId: "msg-1", ...payload },
  });
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error assigning a minimal MockEventSource over the DOM EventSource for tests
  globalThis.EventSource = MockEventSource;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useChatStream", () => {
  it("opens EventSource at the chat proxy URL for the given threadId (REQ-011)", async () => {
    renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    expect(MockEventSource.instances[0]?.url).toBe("/api/chat/stream?threadId=thread-1");
  });

  it("starts as connected=false before open fires, then connected=true after open", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("sets connected=false on EventSource error", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.onerror?.();
    });

    expect(result.current.connected).toBe(false);
  });

  it("accumulates chat.delta frames into message parts (REQ-013)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "Hello " }, 1),
      );
    });

    await waitFor(() => expect(result.current.message).not.toBeNull());
    expect(result.current.message?.parts[0]).toMatchObject({ kind: "text", text: "Hello " });
  });

  it("accumulates multiple delta frames in sequence (REQ-013)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "Hello " }, 1),
      );
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "world" }, 2),
      );
    });

    await waitFor(() =>
      expect(result.current.message?.parts[0]).toMatchObject({
        kind: "text",
        text: "Hello world",
      }),
    );
  });

  it("streaming=true until a terminal frame arrives (REQ-050)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "Hi" }, 1),
      );
    });

    await waitFor(() => expect(result.current.message).not.toBeNull());
    expect(result.current.streaming).toBe(true);
  });

  it("streaming=false after chat.turn_end (REQ-050)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "Hi" }, 1),
      );
      MockEventSource.instances[0]?.emit(
        "chat.turn_end",
        makeFrame("chat.turn_end", { usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 } }, 2),
      );
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.message?.status).toBe("complete");
  });

  it("streaming=false after chat.stopped (REQ-051)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.stopped",
        makeFrame("chat.stopped", {}, 1),
      );
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.message?.status).toBe("stopped");
  });

  it("streaming=false after chat.error (REQ-052)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.error",
        makeFrame("chat.error", { text: "backend failure" }, 1),
      );
    });

    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.message?.status).toBe("error");
    expect(result.current.message?.error).toBe("backend failure");
  });

  it("dedupes repeated frames by id — reconnect does not duplicate parts (EDGE-003)", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    const deltaFrame = makeFrame("chat.delta", { text: "Hi" }, 1);

    act(() => {
      MockEventSource.instances[0]?.emit("chat.delta", deltaFrame);
      MockEventSource.instances[0]?.emit("chat.delta", deltaFrame); // replay
    });

    await waitFor(() => expect(result.current.message).not.toBeNull());
    expect(result.current.message?.parts).toHaveLength(1);
    expect(result.current.message?.parts[0]).toMatchObject({ kind: "text", text: "Hi" });
  });

  it("ignores unknown event kinds silently", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "live.unknown",
        JSON.stringify({ id: "x", sequence: 1, kind: "live.unknown", payload: {} }),
      );
    });

    expect(result.current.message).toBeNull();
  });

  it("closes EventSource on unmount", async () => {
    const { unmount } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    unmount();

    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });

  it("resets state and opens new connection when threadId changes", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useChatStream(id),
      { initialProps: { id: "thread-1" } },
    );
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "Old" }, 1),
      );
    });
    await waitFor(() => expect(result.current.message).not.toBeNull());

    rerender({ id: "thread-2" });

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    expect(result.current.message).toBeNull();
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });

  it("exposes frames array in addition to message", async () => {
    const { result } = renderHook(() => useChatStream("thread-1"));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      MockEventSource.instances[0]?.emit(
        "chat.delta",
        makeFrame("chat.delta", { text: "data" }, 1),
      );
    });

    await waitFor(() => expect(result.current.frames).toHaveLength(1));
  });
});
