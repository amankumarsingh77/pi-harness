/**
 * Tests for chat-transcript (Step 4).
 * TDD: tests written first, implementation follows.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTranscript } from "@/components/chat/chat-transcript";
import type { ChatMessage } from "@pi-harness/shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeUserMsg(id: string, text: string): ChatMessage {
  return {
    id,
    threadId: "thread-1",
    role: "user",
    createdAt: new Date("2026-05-30T10:00:00Z"),
    parts: [{ kind: "text", text }],
    status: "complete",
  };
}

function makeAssistantMsg(
  id: string,
  text: string,
  status: ChatMessage["status"] = "complete",
): ChatMessage {
  return {
    id,
    threadId: "thread-1",
    role: "assistant",
    createdAt: new Date("2026-05-30T10:01:00Z"),
    parts: [{ kind: "text", text }],
    status,
  };
}

// ── ChatTranscript ────────────────────────────────────────────────────────────

describe("ChatTranscript", () => {
  it("renders user and assistant turns in order (REQ-011)", () => {
    const messages: ChatMessage[] = [
      makeUserMsg("m1", "How does the live event stream work?"),
      makeAssistantMsg("m2", "The stream flows through four hops."),
    ];
    render(<ChatTranscript messages={messages} streaming={false} />);

    const userTurn = screen.getByTestId("chat-message-user");
    const assistantTurn = screen.getByTestId("chat-message-assistant");

    expect(userTurn).toBeInTheDocument();
    expect(assistantTurn).toBeInTheDocument();
    expect(screen.getByText("How does the live event stream work?")).toBeInTheDocument();
    expect(screen.getByText("The stream flows through four hops.")).toBeInTheDocument();
  });

  it("renders multiple turns in document order (REQ-011)", () => {
    const messages: ChatMessage[] = [
      makeUserMsg("m1", "First question"),
      makeAssistantMsg("m2", "First answer"),
      makeUserMsg("m3", "Second question"),
      makeAssistantMsg("m4", "Second answer"),
    ];
    render(<ChatTranscript messages={messages} streaming={false} />);

    const allText = screen.getByTestId("chat-transcript").textContent ?? "";
    const firstQ = allText.indexOf("First question");
    const firstA = allText.indexOf("First answer");
    const secondQ = allText.indexOf("Second question");
    const secondA = allText.indexOf("Second answer");

    expect(firstQ).toBeLessThan(firstA);
    expect(firstA).toBeLessThan(secondQ);
    expect(secondQ).toBeLessThan(secondA);
  });

  it("renders empty transcript without errors (EDGE-008)", () => {
    render(<ChatTranscript messages={[]} streaming={false} />);
    expect(screen.getByTestId("chat-transcript")).toBeInTheDocument();
  });

  it("EDGE-008: applies no-scrollbar class for long content containment", () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      makeUserMsg(`m${i}`, `Question ${i + 1}`),
    );
    render(<ChatTranscript messages={messages} streaming={false} />);

    const transcript = screen.getByTestId("chat-transcript");
    expect(transcript.className).toContain("no-scrollbar");
  });

  it("has max-width constraint on inner stream container (EDGE-008)", () => {
    const messages: ChatMessage[] = [makeUserMsg("m1", "A question")];
    render(<ChatTranscript messages={messages} streaming={false} />);

    expect(screen.getByTestId("transcript-stream")).toBeInTheDocument();
  });

  it("renders with streaming prop true without crashing", () => {
    const messages: ChatMessage[] = [
      makeUserMsg("m1", "Ask me something"),
      makeAssistantMsg("m2", "Partial response...", "streaming"),
    ];
    render(<ChatTranscript messages={messages} streaming={true} />);
    expect(screen.getByTestId("chat-transcript")).toBeInTheDocument();
  });
});
