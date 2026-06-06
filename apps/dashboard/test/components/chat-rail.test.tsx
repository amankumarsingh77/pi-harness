/**
 * Tests for chat-rail, chat-composer, and chat-empty-state (Step 3).
 * TDD: tests written first, implementations follow.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatRail } from "@/components/chat/chat-rail";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import type { ChatThread } from "@pi-harness/shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "thread-1",
    title: "Explain the live event stream",
    createdAt: new Date("2026-05-30T08:00:00Z"),
    updatedAt: new Date("2026-05-30T10:00:00Z"),
    branch: "main",
    model: { provider: "crofai", model: "deepseek-v4-pro", thinkingLevel: "medium" },
    ...overrides,
  };
}

// ── ChatRail ─────────────────────────────────────────────────────────────────

describe("ChatRail", () => {
  it("renders a list of threads with title and meta (REQ-003)", () => {
    const threads = [
      makeThread({ id: "t1", title: "Explain the live event stream", branch: "main" }),
      makeThread({ id: "t2", title: "Where are task phases persisted?", branch: "main" }),
    ];

    render(<ChatRail threads={threads} activeThreadId="t1" onNewChat={vi.fn()} onSelectThread={vi.fn()} />);

    expect(screen.getByText("Explain the live event stream")).toBeInTheDocument();
    expect(screen.getByText("Where are task phases persisted?")).toBeInTheDocument();
  });

  it("highlights the active thread (REQ-003)", () => {
    const threads = [
      makeThread({ id: "t1", title: "Explain the live event stream" }),
      makeThread({ id: "t2", title: "Where are task phases persisted?" }),
    ];
    render(<ChatRail threads={threads} activeThreadId="t1" onNewChat={vi.fn()} onSelectThread={vi.fn()} />);

    expect(screen.getByTestId("thread-t1")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("thread-t2")).toHaveAttribute("data-active", "false");
  });

  it("calls onSelectThread when a thread is clicked (REQ-003)", () => {
    const onSelectThread = vi.fn();
    const threads = [makeThread({ id: "t1", title: "Explain the live event stream" })];
    render(<ChatRail threads={threads} activeThreadId={null} onNewChat={vi.fn()} onSelectThread={onSelectThread} />);

    fireEvent.click(screen.getByTestId("thread-t1"));
    expect(onSelectThread).toHaveBeenCalledWith("t1");
  });

  it("calls onNewChat when 'New chat' is clicked (REQ-003)", () => {
    const onNewChat = vi.fn();
    render(<ChatRail threads={[]} activeThreadId={null} onNewChat={onNewChat} onSelectThread={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("groups threads by recency labels Today / Earlier (REQ-003)", () => {
    const now = new Date("2026-05-30T10:00:00Z");
    const today = new Date("2026-05-30T08:00:00Z");
    const earlier = new Date("2026-05-28T08:00:00Z");

    const threads = [
      makeThread({ id: "t1", title: "Today thread", updatedAt: today }),
      makeThread({ id: "t2", title: "Earlier thread", updatedAt: earlier }),
    ];
    render(
      <ChatRail
        threads={threads}
        activeThreadId={null}
        onNewChat={vi.fn()}
        onSelectThread={vi.fn()}
        now={now}
      />,
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Earlier")).toBeInTheDocument();
  });

  it("filters threads by search query (REQ-003)", () => {
    const threads = [
      makeThread({ id: "t1", title: "Explain the live event stream" }),
      makeThread({ id: "t2", title: "Pi agent sessions created" }),
    ];
    render(<ChatRail threads={threads} activeThreadId={null} onNewChat={vi.fn()} onSelectThread={vi.fn()} />);

    const search = screen.getByPlaceholderText(/search chats/i);
    fireEvent.change(search, { target: { value: "live" } });

    expect(screen.getByText("Explain the live event stream")).toBeInTheDocument();
    expect(screen.queryByText("Pi agent sessions created")).not.toBeInTheDocument();
  });

  it("uses a friendly fallback title when a thread title is a raw id", () => {
    const updatedAt = new Date("2026-05-30T10:00:00Z");
    const threadId = "0f15936e-21dd-4214-884d-90b886a6cc7b";
    const threads = [makeThread({ id: threadId, title: threadId, updatedAt })];

    render(
      <ChatRail
        threads={threads}
        activeThreadId={null}
        onNewChat={vi.fn()}
        onSelectThread={vi.fn()}
        now={updatedAt}
      />,
    );

    expect(screen.getByText(/^Chat (May 30|30 May)$/)).toBeInTheDocument();
    expect(screen.queryByText(threadId)).not.toBeInTheDocument();
  });

  it("shows branch and time meta in mono font area (REQ-003)", () => {
    const threads = [makeThread({ id: "t1", branch: "main" })];
    render(<ChatRail threads={threads} activeThreadId={null} onNewChat={vi.fn()} onSelectThread={vi.fn()} />);

    expect(screen.getByTestId("thread-meta-t1")).toHaveTextContent("main");
  });

  it("has data-testid on the rail container for e2e", () => {
    render(<ChatRail threads={[]} activeThreadId={null} onNewChat={vi.fn()} onSelectThread={vi.fn()} />);
    expect(screen.getByTestId("chat-rail")).toBeInTheDocument();
  });
});

// ── ChatComposer ──────────────────────────────────────────────────────────────

describe("ChatComposer", () => {
  it("renders textarea with placeholder (REQ-030)", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} streaming={false} />);
    expect(screen.getByPlaceholderText(/ask about the codebase/i)).toBeInTheDocument();
  });

  it("shows send button when not streaming (REQ-030)", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} streaming={false} />);
    const btn = screen.getByRole("button", { name: /send/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveClass("stop");
  });

  it("shows stop button when streaming (REQ-030)", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} streaming={true} />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("calls onSend with message text when enter is pressed (REQ-030)", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} streaming={false} />);
    const textarea = screen.getByPlaceholderText(/ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: "How does the live event stream work?" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSend).toHaveBeenCalledWith("How does the live event stream work?");
  });

  it("calls onSend when send button is clicked (REQ-030)", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} streaming={false} />);
    const textarea = screen.getByPlaceholderText(/ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: "Explain the architecture." } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith("Explain the architecture.");
  });

  it("EDGE-007: rejects empty message — onSend is not called", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} streaming={false} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("EDGE-007: rejects whitespace-only message", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} streaming={false} />);
    const textarea = screen.getByPlaceholderText(/ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onStop when stop button is clicked (REQ-031)", () => {
    const onStop = vi.fn();
    render(<ChatComposer onSend={vi.fn()} onStop={onStop} streaming={true} />);
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));

    expect(onStop).toHaveBeenCalledOnce();
  });

  it("Shift+Enter inserts a newline instead of sending (REQ-030)", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onStop={vi.fn()} streaming={false} />);
    const textarea = screen.getByPlaceholderText(/ask about the codebase/i);
    fireEvent.change(textarea, { target: { value: "Line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows read-only hint copy", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} streaming={false} />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("has data-testid for e2e", () => {
    render(<ChatComposer onSend={vi.fn()} onStop={vi.fn()} streaming={false} />);
    expect(screen.getByTestId("chat-composer")).toBeInTheDocument();
  });
});

// ── ChatEmptyState ────────────────────────────────────────────────────────────

describe("ChatEmptyState", () => {
  it("renders kicker, title, and subtitle (REQ-002)", () => {
    render(<ChatEmptyState onPromptSelect={vi.fn()} />);

    expect(screen.getByText(/repo-scoped assistant/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ask about this codebase/i })).toBeInTheDocument();
    expect(screen.getByText(/read-only by default/i)).toBeInTheDocument();
  });

  it("renders 4 prompt cards (REQ-002)", () => {
    render(<ChatEmptyState onPromptSelect={vi.fn()} />);
    const cards = screen.getAllByTestId("prompt-card");
    expect(cards).toHaveLength(4);
  });

  it("calls onPromptSelect when a prompt card is clicked (REQ-002)", () => {
    const onPromptSelect = vi.fn();
    render(<ChatEmptyState onPromptSelect={onPromptSelect} />);

    const firstCard = screen.getAllByTestId("prompt-card")[0]!;
    fireEvent.click(firstCard);

    expect(onPromptSelect).toHaveBeenCalledOnce();
    expect(typeof onPromptSelect.mock.calls[0]![0]).toBe("string");
    expect(onPromptSelect.mock.calls[0]![0].length).toBeGreaterThan(0);
  });

  it("has data-testid for e2e", () => {
    render(<ChatEmptyState onPromptSelect={vi.fn()} />);
    expect(screen.getByTestId("chat-empty-state")).toBeInTheDocument();
  });

  it("each prompt card has a subtitle span with supporting detail", () => {
    render(<ChatEmptyState onPromptSelect={vi.fn()} />);
    const cards = screen.getAllByTestId("prompt-card");
    for (const card of cards) {
      const span = card.querySelector("span");
      expect(span).not.toBeNull();
      expect(span!.textContent!.length).toBeGreaterThan(0);
    }
  });
});
