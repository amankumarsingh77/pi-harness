import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { orchestrator, getChatThreadOrNull } from "@/lib/server/api";
import { ChatView } from "@/components/chat/chat-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadId: string }>;
}): Promise<Metadata> {
  const { threadId } = await params;
  return { title: `Chat · ${threadId} · pi-harness` };
}

/**
 * /chat/[threadId] — server component.
 *
 * Fetches thread + messages from the orchestrator, renders ChatView wrapped in
 * ChatLiveProvider so live frames merge onto the server snapshot (REQ-051).
 *
 * REQ-001, REQ-010, REQ-011, REQ-030, REQ-031, REQ-040, REQ-051
 */
export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;

  // Returns thread: null on 404/503 so we can render the not-found page.
  const detail = await getChatThreadOrNull(threadId);
  if (!detail.thread) notFound();

  const [{ threads }, { providers }, { summary }] = await Promise.all([
    orchestrator.listChatThreads().catch(() => ({ threads: [] })),
    orchestrator.getProviders().catch(() => ({ providers: [] })),
    orchestrator.listTasks().catch(() => ({ summary: undefined })),
  ]);

  return (
    <Suspense fallback={null}>
      <ChatView
        thread={detail.thread}
        initialMessages={detail.messages}
        threads={threads}
        activeThreadId={threadId}
        providers={providers}
        {...(summary ? { summary } : {})}
      />
    </Suspense>
  );
}
