"use client";

/**
 * ChatLiveProvider
 *
 * Client context that wires useChatStream to a threadId, exposing the live
 * streaming message and connection state. Mirrors RunLiveProvider exactly:
 * initial server-fetched messages are passed as props; live frames from
 * useChatStream merge onto them in chat-view.
 *
 * REQ-051 — resume seamlessly: initial messages + streamed frames merged by id.
 */

import type { ChatMessage } from "@pi-harness/shared";

/**
 * Merges server-fetched messages with a live streaming message.
 *
 * The live message replaces any server message with the same id
 * (REQ-051: resume seamlessly — no duplicates).
 */
export function mergeChatMessages(
  initialMessages: readonly ChatMessage[],
  liveMessage: ChatMessage | null,
): ChatMessage[] {
  if (!liveMessage) return [...initialMessages];

  const byId = new Map<string, ChatMessage>();
  for (const msg of initialMessages) byId.set(msg.id, msg);
  byId.set(liveMessage.id, liveMessage);

  // Sort by createdAt ascending
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/**
 * Merges two message lists by id. The server list wins on conflicts (it carries
 * the finalized record), but messages present only locally are preserved — so a
 * stale or partial server snapshot can never drop a message we already know
 * about (e.g. an optimistically-appended user message that the snapshot predates).
 * Sorted by createdAt ascending.
 */
export function mergeMessageLists(
  local: readonly ChatMessage[],
  server: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const msg of local) byId.set(msg.id, msg);
  for (const msg of server) byId.set(msg.id, msg); // server last → wins on conflict
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
