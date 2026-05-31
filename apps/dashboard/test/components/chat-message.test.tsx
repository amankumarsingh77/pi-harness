/**
 * Tests for chat-thinking, chat-tool-call, and chat-message components (Step 1).
 * TDD: tests written first, implementations follow.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatThinking } from "@/components/chat/chat-thinking";
import { ChatToolCall } from "@/components/chat/chat-tool-call";
import { ChatMessage } from "@/components/chat/chat-message";
import type { ChatMessage as ChatMessageType } from "@pi-harness/shared";

// ── ChatThinking ──────────────────────────────────────────────────────────────

describe("ChatThinking", () => {
  it("renders collapsed by default with toggle button", () => {
    render(<ChatThinking text="I need to trace the event flow." durationSecs={6} />);
    expect(screen.getByRole("button", { name: /thought/i })).toBeInTheDocument();
    expect(screen.queryByText("I need to trace the event flow.")).not.toBeInTheDocument();
  });

  it("expands when the toggle is clicked (aria-expanded toggles)", () => {
    render(<ChatThinking text="I need to trace the event flow." durationSecs={6} />);
    const toggle = screen.getByRole("button", { name: /thought/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("I need to trace the event flow.")).toBeInTheDocument();
  });

  it("collapses again when toggle is clicked a second time", () => {
    render(<ChatThinking text="Deep reasoning about the codebase." durationSecs={3} />);
    const toggle = screen.getByRole("button", { name: /thought/i });

    fireEvent.click(toggle);
    expect(screen.getByText("Deep reasoning about the codebase.")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Deep reasoning about the codebase.")).not.toBeInTheDocument();
  });

  it("shows elapsed duration in the summary (EDGE-005 companion: only when non-empty)", () => {
    render(<ChatThinking text="Thinking step." durationSecs={4} />);
    expect(screen.getByText(/for 4s/)).toBeInTheDocument();
  });

  it("EDGE-005: renders nothing when text is empty", () => {
    const { container } = render(<ChatThinking text="" durationSecs={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("has data-testid for e2e targeting", () => {
    render(<ChatThinking text="Reasoning." durationSecs={2} />);
    expect(screen.getByTestId("chat-thinking")).toBeInTheDocument();
  });
});

// ── ChatToolCall ──────────────────────────────────────────────────────────────

describe("ChatToolCall", () => {
  it("renders tool name and arg in running state (REQ-021/022)", () => {
    render(
      <ChatToolCall
        callId="call-1"
        tool="grep"
        input='createAgentSession --type ts'
        status="running"
      />,
    );
    expect(screen.getByText("grep")).toBeInTheDocument();
    expect(screen.getByText(/createAgentSession --type ts/)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it("shows st-ok status after completion with timing (REQ-023)", () => {
    render(
      <ChatToolCall
        callId="call-1"
        tool="grep"
        input='createAgentSession --type ts'
        status="ok"
        durationMs={320}
      />,
    );
    expect(screen.getByTestId("tool-status")).toHaveTextContent(/12 hits|ok|done/i);
    expect(screen.getByTestId("tool-duration")).toHaveTextContent(/0\.3s|320ms/);
  });

  it("shows st-err status on error (REQ-023)", () => {
    render(
      <ChatToolCall
        callId="call-1"
        tool="bash"
        input="pnpm test"
        status="error"
        output="exit code 1"
      />,
    );
    expect(screen.getByTestId("tool-status")).toHaveTextContent(/error|fail/i);
  });

  it("expands output when available and toggled", () => {
    render(
      <ChatToolCall
        callId="call-1"
        tool="read"
        input="packages/pi-bridge/src/agent-session.ts"
        status="ok"
        output="export type PiBridgeEvent = ..."
        durationMs={100}
      />,
    );
    // output is hidden initially
    expect(screen.queryByText("export type PiBridgeEvent = ...")).not.toBeInTheDocument();
    // click expands
    fireEvent.click(screen.getByTestId("chat-tool-call"));
    expect(screen.getByText("export type PiBridgeEvent = ...")).toBeInTheDocument();
  });

  it("has data-testid for e2e", () => {
    render(
      <ChatToolCall callId="c1" tool="read" input="file.ts" status="running" />,
    );
    expect(screen.getByTestId("chat-tool-call")).toBeInTheDocument();
  });
});

// ── ChatMessage ───────────────────────────────────────────────────────────────

const baseAssistant: ChatMessageType = {
  id: "msg-1",
  threadId: "thread-1",
  role: "assistant",
  createdAt: new Date("2026-05-30T10:00:00Z"),
  parts: [{ kind: "text", text: "The stream flows through four hops." }],
  status: "complete",
};

const baseUser: ChatMessageType = {
  id: "msg-2",
  threadId: "thread-1",
  role: "user",
  createdAt: new Date("2026-05-30T10:00:00Z"),
  parts: [{ kind: "text", text: "How does the live event stream work?" }],
  status: "complete",
};

describe("ChatMessage", () => {
  it("renders user message bubble with correct text (REQ-011)", () => {
    render(<ChatMessage message={baseUser} />);
    expect(screen.getByText("How does the live event stream work?")).toBeInTheDocument();
    expect(screen.getByTestId("chat-message-user")).toBeInTheDocument();
  });

  it("renders assistant message with pi avatar (REQ-011)", () => {
    render(<ChatMessage message={baseAssistant} />);
    expect(screen.getByTestId("chat-message-assistant")).toBeInTheDocument();
    expect(screen.getByText(/The stream flows through four hops\./)).toBeInTheDocument();
  });

  it("shows streaming cursor only when status=streaming (REQ-012)", () => {
    const { rerender } = render(
      <ChatMessage message={{ ...baseAssistant, status: "streaming" }} />,
    );
    expect(document.querySelector(".cursor")).toBeInTheDocument();

    rerender(<ChatMessage message={{ ...baseAssistant, status: "complete" }} />);
    expect(document.querySelector(".cursor")).not.toBeInTheDocument();
  });

  it("renders stopped notice when status=stopped (REQ-032)", () => {
    render(
      <ChatMessage
        message={{ ...baseAssistant, status: "stopped" }}
      />,
    );
    expect(screen.getByTestId("notice-stopped")).toBeInTheDocument();
    expect(screen.getByText(/stopped by you/i)).toBeInTheDocument();
  });

  it("renders error notice when status=error (REQ-052)", () => {
    render(
      <ChatMessage
        message={{
          ...baseAssistant,
          status: "error",
          error: "orchestrator unreachable (503)",
        }}
      />,
    );
    expect(screen.getByTestId("notice-error")).toBeInTheDocument();
    expect(screen.getByText(/503/)).toBeInTheDocument();
  });

  it("renders thinking part when present", () => {
    const msg: ChatMessageType = {
      ...baseAssistant,
      parts: [
        { kind: "thinking", text: "Reasoning about the flow..." },
        { kind: "text", text: "Answer here." },
      ],
    };
    render(<ChatMessage message={msg} />);
    // thinking toggle present
    expect(screen.getByTestId("chat-thinking")).toBeInTheDocument();
  });

  it("EDGE-005: does not render thinking block when thinking text is empty", () => {
    const msg: ChatMessageType = {
      ...baseAssistant,
      parts: [
        { kind: "thinking", text: "" },
        { kind: "text", text: "No thinking here." },
      ],
    };
    render(<ChatMessage message={msg} />);
    expect(screen.queryByTestId("chat-thinking")).not.toBeInTheDocument();
  });

  it("collapses multiple thinking bursts into a single block, in order", () => {
    // A multi-step agent turn interleaves thinking and tool parts, producing one
    // thinking part per burst. They must render as ONE collapsible block.
    const msg: ChatMessageType = {
      ...baseAssistant,
      status: "streaming",
      parts: [
        { kind: "thinking", text: "First I explore." },
        { kind: "tool", callId: "c1", tool: "read", input: {}, status: "ok" },
        { kind: "thinking", text: "Then I verify." },
        { kind: "tool", callId: "c2", tool: "bash", input: {}, status: "ok" },
        { kind: "thinking", text: "Now I answer." },
      ],
    };
    render(<ChatMessage message={msg} />);
    const blocks = screen.getAllByTestId("chat-thinking");
    expect(blocks).toHaveLength(1);
    // Streaming → auto-expanded; all bursts present in arrival order.
    const text = blocks[0]?.textContent ?? "";
    expect(text).toContain("First I explore.");
    expect(text).toContain("Then I verify.");
    expect(text).toContain("Now I answer.");
    expect(text.indexOf("First I explore.")).toBeLessThan(text.indexOf("Then I verify."));
    expect(text.indexOf("Then I verify.")).toBeLessThan(text.indexOf("Now I answer."));
  });

  it("renders tool call parts", () => {
    const msg: ChatMessageType = {
      ...baseAssistant,
      parts: [
        {
          kind: "tool",
          callId: "c-1",
          tool: "grep",
          input: '"createAgentSession"',
          status: "ok",
        },
      ],
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId("chat-tool-call")).toBeInTheDocument();
  });

  it("renders usage footer when complete with usage data", () => {
    const msg: ChatMessageType = {
      ...baseAssistant,
      status: "complete",
      usage: { inputTokens: 1000, outputTokens: 500, costUsd: 0.0042 },
    };
    render(<ChatMessage message={msg} />);
    expect(screen.getByTestId("msg-usage")).toBeInTheDocument();
  });
});
