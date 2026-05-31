"use client";

/**
 * ChatPageClient — client wrapper for the /chat landing page.
 *
 * Renders the rail + empty state + a composer (same single-box composer as a
 * thread view). Typing a message or picking a prompt creates a thread with the
 * chosen model, then navigates to /chat/[threadId]?prompt=… where ChatView
 * auto-sends it. Model + thinking pickers live inside the composer.
 *
 * REQ-001, REQ-002, REQ-003, REQ-040, REQ-044
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import type {
  ChatModelSelection,
  ChatThinkingLevel,
  ChatThread,
  DashboardSummary,
} from "@pi-harness/shared";
import { DEFAULT_PHASE_MODELS } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { ChatRail } from "@/components/chat/chat-rail";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ModelPicker } from "@/components/chat/model-picker";
import { ThinkingPicker } from "@/components/chat/thinking-picker";
import { buildProviderEntries } from "@/lib/chat/available-models";
import { mutations } from "@/lib/client/queries";
import type { Provider } from "@/lib/api";

type Props = {
  readonly threads: readonly ChatThread[];
  /** Full provider + model catalog (fetched server-side). */
  readonly providers: readonly Provider[];
  /** Board telemetry for the top nav (running/review/blocked counts). */
  readonly summary?: DashboardSummary;
};

/** Default model for a brand-new thread (mirrors the orchestrator default). */
function defaultModel(): ChatModelSelection {
  const m = DEFAULT_PHASE_MODELS.brainstorm;
  const level: ChatThinkingLevel =
    m.thinkingLevel === "off" ? "off"
    : m.thinkingLevel === "low" || m.thinkingLevel === "minimal" ? "low"
    : m.thinkingLevel === "medium" ? "medium"
    : "high";
  return { provider: m.provider, model: m.model, thinkingLevel: level };
}

export function ChatPageClient({ threads, providers, summary }: Props) {
  const router = useRouter();
  const createThread = useMutation(mutations.createChatThread());
  const [model, setModel] = useState<ChatModelSelection>(defaultModel);
  const providerEntries = buildProviderEntries(providers);

  // Create a thread with the chosen model, then hand the prompt off via the
  // query string so ChatView sends it after navigation.
  function startThread(text: string) {
    createThread.mutate(
      { model },
      {
        onSuccess: (thread) => {
          router.push(`/chat/${thread.id}?prompt=${encodeURIComponent(text)}`);
        },
      },
    );
  }

  function handleNewChat() {
    createThread.mutate(
      { model },
      { onSuccess: (thread) => router.push(`/chat/${thread.id}`) },
    );
  }

  function handleSelectThread(id: string) {
    router.push(`/chat/${id}`);
  }

  function handleModelSelect(provider: string, modelId: string) {
    setModel((m) => ({ provider, model: modelId, thinkingLevel: m.thinkingLevel }));
  }

  function handleThinkingSelect(level: ChatThinkingLevel) {
    setModel((m) => ({ ...m, thinkingLevel: level }));
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <Topbar {...(summary ? { summary } : {})} branch="main" />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Rail */}
        <div className="hidden w-[220px] flex-none lg:block">
          <ChatRail
            threads={threads}
            activeThreadId={null}
            onNewChat={handleNewChat}
            onSelectThread={handleSelectThread}
          />
        </div>

        {/* Empty state + composer */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="no-scrollbar flex-1 overflow-y-auto">
            <ChatEmptyState onPromptSelect={startThread} />
          </div>

          <ChatComposer
            streaming={false}
            onSend={startThread}
            onStop={() => {}}
            modelPicker={
              <ModelPicker
                providers={providerEntries}
                selected={model}
                onSelect={handleModelSelect}
                openUp
              />
            }
            thinkingPicker={
              <ThinkingPicker
                level={model.thinkingLevel}
                onSelect={handleThinkingSelect}
                openUp
              />
            }
          />
        </div>
      </div>
    </div>
  );
}
