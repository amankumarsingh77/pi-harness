import type { Metadata } from "next";
import { orchestrator } from "@/lib/server/api";
import { ChatPageClient } from "./page-client";

export const metadata: Metadata = { title: "Chat · pi-harness" };
export const dynamic = "force-dynamic";

/**
 * /chat — server component.
 *
 * Lists threads and renders the rail + empty state landing page.
 * "New chat" and thread selection are handled by the client shell.
 *
 * REQ-001, REQ-002, REQ-003
 */
export default async function ChatPage() {
  const [{ threads }, { providers }] = await Promise.all([
    orchestrator.listChatThreads(),
    orchestrator.getProviders(),
  ]);

  return <ChatPageClient threads={threads} providers={providers} />;
}
