/**
 * chat-view.test.tsx
 *
 * Integration tests for <ChatView> — the client shell that composes rail,
 * transcript, composer, pickers, and wires mutations + useChatStream.
 *
 * Pattern: MockEventSource (mission-command-live.test.tsx) + mocked mutations.
 *
 * REQ-001, REQ-002, REQ-003, REQ-010, REQ-030, REQ-031, REQ-040, EDGE-001
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatView } from "@/components/chat/chat-view";
import type { ChatProvider } from "@/lib/api";
import type { ChatMessage, ChatModelSelection, ChatThread } from "@pi-harness/shared";

const mockRouter = { push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/chat/thread-1",
  useSearchParams: () => new URLSearchParams(),
}));

// ── MockEventSource ───────────────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, Array<(ev: MessageEvent<string>) => void>>();
  readonly url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_MODEL: ChatModelSelection = {
  provider: "crofai",
  model: "deepseek-v4-pro",
  thinkingLevel: "medium",
};

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread-1",
    title: "Test thread",
    createdAt: new Date("2026-05-30T08:00:00Z"),
    updatedAt: new Date("2026-05-30T10:00:00Z"),
    branch: "main",
    model: DEFAULT_MODEL,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    role: "user",
    createdAt: new Date("2026-05-30T10:00:00Z"),
    parts: [{ kind: "text", text: "Hello world" }],
    status: "complete",
    ...overrides,
  };
}

// ── Mock fetch ────────────────────────────────────────────────────────────────

beforeEach(() => {
  MockEventSource.instances = [];
  mockRouter.push.mockReset();
  // @ts-expect-error test EventSource shim
  globalThis.EventSource = MockEventSource;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      // postChatMessage
      if (url.includes("/messages") && !url.includes("stream")) {
        return Response.json({
          userMessage: makeMessage({ id: "msg-user", role: "user" }),
          assistantMessageId: "msg-asst",
        });
      }

      // stopChatTurn
      if (url.includes("/stop")) {
        return Response.json({ stopped: true });
      }

      // updateChatModel
      if (url.includes("/model")) {
        return Response.json(makeThread({ model: { provider: "crofai", model: "kimi-k2.6", thinkingLevel: "off" } }));
      }

      return Response.json({});
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
      mutations: { retry: false },
    },
  });
}

const PROVIDERS_FIXTURE: ChatProvider[] = [
  {
    id: "crofai",
    name: "CrofAI",
    authenticated: true,
    auth: "api-key",
    models: [
      { id: "kimi-k2.6", name: "MoonshotAI: Kimi K2.6", contextWindow: 262144, cost: { input: 0.5, output: 1.99 }, reasoning: true },
      { id: "deepseek-v4-pro", name: "DeepSeek: DeepSeek V4 Pro", contextWindow: 1_000_000, cost: { input: 0.4, output: 0.85 }, reasoning: true },
    ],
  },
];

function renderView(
  overrides: {
    thread?: ChatThread;
    messages?: ChatMessage[];
    threads?: ChatThread[];
    providers?: ChatProvider[];
  } = {},
) {
  const thread = overrides.thread ?? makeThread();
  const messages = overrides.messages ?? [];
  const threads = overrides.threads ?? [thread];
  const providers = overrides.providers ?? PROVIDERS_FIXTURE;

  render(
    <QueryClientProvider client={queryClient()}>
      <ChatView
        thread={thread}
        initialMessages={messages}
        threads={threads}
        activeThreadId={thread.id}
        providers={providers}
      />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatView", () => {
  it("renders the rail, transcript and composer (REQ-001, REQ-002, REQ-003)", () => {
    // Pass a message so transcript is visible (empty-state is shown when messages=[])
    renderView({ messages: [makeMessage()] });

    expect(screen.getByTestId("chat-rail")).toBeInTheDocument();
    expect(screen.getByTestId("chat-transcript")).toBeInTheDocument();
    expect(screen.getByTestId("chat-composer")).toBeInTheDocument();
  });

  it("renders initial messages in the transcript", () => {
    const messages = [
      makeMessage({ id: "m1", role: "user", parts: [{ kind: "text", text: "Explain the event flow" }] }),
    ];
    renderView({ messages });

    expect(screen.getByText("Explain the event flow")).toBeInTheDocument();
  });

  it("calls postChatMessage mutation when a message is sent (REQ-010)", async () => {
    const fetchSpy = vi.mocked(fetch);
    renderView();

    const textarea = screen.getByPlaceholderText(/Ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: "What is the live event store?" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/proxy/chat/threads/thread-1/messages"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("calls stopChatTurn mutation when stop button is clicked (REQ-031)", async () => {
    const fetchSpy = vi.mocked(fetch);
    renderView();

    // Start a stream to make streaming=true
    const es = MockEventSource.instances[0];
    if (!es) throw new Error("EventSource not created");

    // Simulate streaming state by emitting a delta frame
    const deltaFrame = JSON.stringify({
      id: "frame-1",
      sequence: 1,
      ts: new Date().toISOString(),
      threadId: "thread-1",
      kind: "chat.delta",
      payload: { messageId: "msg-asst", text: "Hello" },
    });

    act(() => {
      es.emit("chat.delta", deltaFrame);
    });

    // Now the stop button should be visible (streaming=true)
    await waitFor(() => {
      const stopBtn = screen.queryByRole("button", { name: "Stop" });
      expect(stopBtn).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/proxy/chat/threads/thread-1/stop"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("disables composer send while streaming (EDGE-001)", async () => {
    renderView();

    const es = MockEventSource.instances[0];
    if (!es) throw new Error("EventSource not created");

    const deltaFrame = JSON.stringify({
      id: "frame-2",
      sequence: 1,
      ts: new Date().toISOString(),
      threadId: "thread-1",
      kind: "chat.delta",
      payload: { messageId: "msg-asst", text: "Streaming…" },
    });

    act(() => {
      es.emit("chat.delta", deltaFrame);
    });

    await waitFor(() => {
      // While streaming, Enter key should not fire postChatMessage
      const textarea = screen.getByPlaceholderText(/Ask about the codebase/i);
      fireEvent.change(textarea, { target: { value: "Another message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    // Verify that only one fetch call was made (no send during streaming)
    const postCalls = vi.mocked(fetch).mock.calls.filter(
      ([url]) => String(url).includes("/messages"),
    );
    expect(postCalls).toHaveLength(0);
  });

  it("renders streamed delta frames in the transcript (REQ-011)", async () => {
    renderView();

    const es = MockEventSource.instances[0];
    if (!es) throw new Error("EventSource not created");

    act(() => {
      es.emit(
        "chat.delta",
        JSON.stringify({
          id: "frame-3",
          sequence: 1,
          ts: new Date().toISOString(),
          threadId: "thread-1",
          kind: "chat.delta",
          payload: { messageId: "msg-live", text: "Live streamed text" },
        }),
      );
    });

    await screen.findByText("Live streamed text");
  });

  it("calls updateChatModel mutation when a model is selected (REQ-040)", async () => {
    const fetchSpy = vi.mocked(fetch);
    renderView({ messages: [makeMessage()] });

    // Use the ModelPicker's own trigger button (aria-haspopup=listbox)
    const pickerRoot = screen.getByTestId("model-picker");
    const trigger = within(pickerRoot).getByRole("button");
    fireEvent.click(trigger);

    // Pick an available model from the picker dropdown
    const kimiBtn = await screen.findByRole("option", { name: /kimi/i });
    fireEvent.click(kimiBtn);

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/proxy/chat/threads/thread-1/model"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("shows the selected model in the composer's model picker (REQ-040)", () => {
    renderView();
    // The model picker lives inside the composer and shows the friendly model
    // name for the current selection; the trigger's aria-label carries the slug.
    const composer = screen.getByTestId("chat-composer");
    const picker = within(composer).getByTestId("model-picker");
    expect(within(picker).getByRole("button")).toHaveAttribute(
      "aria-label",
      "crofai/deepseek-v4-pro",
    );
    expect(picker).toHaveTextContent("DeepSeek: DeepSeek V4 Pro");
  });

  it("keeps the optimistic user message when reconcile returns a user-less snapshot", async () => {
    // Reproduces the new-chat bug: the user message exists only optimistically;
    // the turn-end reconcile must not drop it even if the server GET returns a
    // stale snapshot that lacks it.
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/messages") && !url.includes("stream")) {
        return Response.json({
          userMessage: makeMessage({ id: "msg-user", role: "user", parts: [{ kind: "text", text: "PROBE_USER_MSG" }] }),
          assistantMessageId: "msg-asst",
        });
      }
      // GET thread reconcile — stale snapshot WITHOUT the user message.
      if (url.includes("/proxy/chat/threads/thread-1") && !url.includes("stream")) {
        return Response.json({
          thread: makeThread(),
          messages: [
            { id: "msg-asst", threadId: "thread-1", role: "assistant", createdAt: new Date("2026-05-30T10:00:05Z").toISOString(), parts: [{ kind: "text", text: "done" }], status: "complete" },
          ],
        });
      }
      return Response.json({});
    });

    renderView({ messages: [] });

    // Send the first message.
    const textarea = screen.getByPlaceholderText(/Ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: "PROBE_USER_MSG" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    // User bubble appears optimistically.
    await screen.findByText("PROBE_USER_MSG");

    // Drive the turn to completion → triggers the reconcile fetch.
    const es = MockEventSource.instances[0];
    if (!es) throw new Error("EventSource not created");
    act(() => {
      es.emit(
        "chat.turn_end",
        JSON.stringify({
          id: "frame-end",
          sequence: 1,
          ts: new Date().toISOString(),
          threadId: "thread-1",
          kind: "chat.turn_end",
          payload: { messageId: "msg-asst", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } },
        }),
      );
    });

    // After reconcile, the user message must still be in the transcript.
    await waitFor(() => {
      expect(screen.getByText("PROBE_USER_MSG")).toBeInTheDocument();
    });
  });
});
