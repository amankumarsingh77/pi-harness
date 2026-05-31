/**
 * Tests for the chat message merge helpers (chat-live-provider).
 *
 * mergeMessageLists is the guard that prevents a stale/partial server snapshot
 * from dropping an optimistically-appended user message during reconcile.
 */
import { describe, it, expect } from "vitest";
import { mergeMessageLists } from "@/lib/chat/chat-live-provider";
import type { ChatMessage } from "@pi-harness/shared";

function msg(id: string, role: ChatMessage["role"], at: string, text: string): ChatMessage {
  return {
    id,
    threadId: "t1",
    role,
    createdAt: new Date(at),
    parts: [{ kind: "text", text }],
    status: "complete",
  };
}

describe("mergeMessageLists", () => {
  it("preserves a local-only message the server snapshot omits", () => {
    const local = [msg("u1", "user", "2026-05-30T10:00:00.000Z", "hello")];
    const server: ChatMessage[] = []; // stale snapshot taken before the user msg
    const merged = mergeMessageLists(local, server);
    expect(merged.map((m) => m.id)).toEqual(["u1"]);
  });

  it("server record wins on id conflict (finalized over optimistic)", () => {
    const local = [msg("a1", "assistant", "2026-05-30T10:00:01.000Z", "partial")];
    const server = [msg("a1", "assistant", "2026-05-30T10:00:01.000Z", "final answer")];
    const merged = mergeMessageLists(local, server);
    expect(merged).toHaveLength(1);
    const part = merged[0]?.parts[0];
    expect(part && part.kind === "text" && part.text).toBe("final answer");
  });

  it("unions and orders by createdAt ascending", () => {
    const local = [msg("u1", "user", "2026-05-30T10:00:00.000Z", "q")];
    const server = [msg("a1", "assistant", "2026-05-30T10:00:02.000Z", "a")];
    const merged = mergeMessageLists(local, server);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1"]);
  });
});
