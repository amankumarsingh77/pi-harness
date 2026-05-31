"use client";

/**
 * ChatView — client shell that composes the full chat interface.
 *
 * Composes: ChatRail + ChatTranscript + ChatComposer + ModelPicker + ThinkingPicker.
 * Owns: send/stop/model-change handlers calling mutations; binds useChatStream.
 *
 * EDGE-001: composer is disabled (send blocked) while streaming is in progress.
 * REQ-051: initial server messages + live frames merged by id.
 *
 * REQ-001, REQ-002, REQ-003, REQ-010, REQ-030, REQ-031, REQ-040, REQ-041,
 * REQ-043, REQ-044, EDGE-001
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ChatMessage, ChatModelSelection, ChatThread, ChatThinkingLevel } from "@pi-harness/shared";
import { queries } from "@/lib/client/queries";
import { useQueryClient } from "@tanstack/react-query";
import { ChatRail } from "./chat-rail";
import { ChatTranscript } from "./chat-transcript";
import { ChatComposer } from "./chat-composer";
import { ModelPicker } from "./model-picker";
import { ThinkingPicker } from "./thinking-picker";
import { ChatEmptyState } from "./chat-empty-state";
import { mergeChatMessages, mergeMessageLists } from "@/lib/chat/chat-live-provider";
import { useChatStream } from "@/lib/chat/use-chat-stream";
import { buildProviderEntries } from "@/lib/chat/available-models";
import { mutations } from "@/lib/client/queries";
import type { Provider } from "@/lib/api";

type Props = {
  readonly thread: ChatThread;
  readonly initialMessages: readonly ChatMessage[];
  readonly threads: readonly ChatThread[];
  readonly activeThreadId: string;
  /** Full provider + model catalog (fetched server-side). */
  readonly providers: readonly Provider[];
};

/**
 * ChatView — client shell for the active chat thread.
 */
export function ChatView({ thread, initialMessages, threads, activeThreadId, providers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const stream = useChatStream(thread.id);

  const providerEntries = buildProviderEntries(providers);

  // Model + thinking state (optimistic — updated before the mutation confirms)
  const [model, setModel] = useState<ChatModelSelection>(thread.model);

  // Completed transcript: every finalized turn (user + assistant). Seeded from
  // the server snapshot, appended optimistically on send, and reconciled from
  // the server when each turn completes. The in-flight assistant message comes
  // from `stream.message` and is merged on top by id.
  const [baseMessages, setBaseMessages] = useState<readonly ChatMessage[]>(initialMessages);

  // When a turn finishes (terminal frame → not streaming, message complete),
  // refetch the thread so the finalized assistant message joins the transcript
  // and future turns append rather than replace.
  const lastReconciledRef = useRef<string | null>(null);
  useEffect(() => {
    const m = stream.message;
    if (!m || stream.streaming) return;
    if (m.status === "streaming") return;
    if (lastReconciledRef.current === m.id) return;
    lastReconciledRef.current = m.id;
    void queryClient
      // staleTime: 0 — never serve a cached snapshot taken before this turn's
      // messages were persisted (the user message lives only ~ms before the
      // assistant row, so a 5s-fresh cache entry can predate it).
      .fetchQuery({ ...queries.getChatThread(thread.id), staleTime: 0 })
      .then((detail) => {
        // Merge (don't replace): a stale/partial server snapshot must never drop
        // a message we already have locally — e.g. the optimistically-appended
        // user message. Server records win on id conflicts (they're finalized).
        if (detail?.messages) {
          setBaseMessages((prev) => mergeMessageLists(prev, detail.messages));
        }
      })
      .catch(() => {
        // Fall back to folding the finished live message into the local list.
        setBaseMessages((prev) => mergeChatMessages(prev, m));
      });
  }, [stream.message, stream.streaming, thread.id, queryClient]);

  // Render = persisted turns + the in-flight assistant message (merged by id).
  const messages = mergeChatMessages(baseMessages, stream.message);

  // `pending` covers the gap between POST and the first SSE frame: the moment
  // the user sends, we show the stop button + a pending row, before
  // `stream.streaming` (which only flips on the first frame) takes over.
  //
  // It must NOT be cleared by a *previous* turn's lingering `stream.message`
  // (the hook keeps the last turn's message until the threadId changes). So we
  // snapshot the live message id at send time and clear `pending` only when the
  // stream begins streaming, or surfaces a message id different from that
  // snapshot (i.e. the new turn's frames have arrived).
  const [pending, setPending] = useState(false);
  const pendingBaselineIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pending) return;
    const liveId = stream.message?.id ?? null;
    if (stream.streaming || liveId !== pendingBaselineIdRef.current) {
      setPending(false);
    }
  }, [pending, stream.streaming, stream.message]);

  // A turn is active from the instant of send until the stream goes terminal.
  const active = pending || stream.streaming;

  // True while a turn is active but the assistant has produced nothing visible
  // yet (no thinking, tool, or text). Drives the animated pending row so the
  // user gets immediate feedback before the first token.
  const liveParts = stream.streaming ? (stream.message?.parts ?? []) : [];
  const hasVisibleOutput = liveParts.some(
    (p) =>
      (p.kind === "text" && p.text.length > 0) ||
      (p.kind === "thinking" && p.text.length > 0) ||
      p.kind === "tool",
  );
  const awaitingResponse = active && !hasVisibleOutput;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const sendMessage = useMutation(mutations.postChatMessage(thread.id));
  const stopTurn = useMutation(mutations.stopChatTurn(thread.id));
  const updateModel = useMutation(mutations.updateChatModel(thread.id));

  // ── Handlers ───────────────────────────────────────────────────────────────

  function startTurn(text: string) {
    // EDGE-001: do not send while a turn is active
    if (active) return;
    // Snapshot the live message id now; pending clears once a different id
    // (the new turn) or streaming appears.
    pendingBaselineIdRef.current = stream.message?.id ?? null;
    setPending(true); // immediate stop-button + pending row
    sendMessage.mutate(
      { text },
      {
        onSuccess: (res) => {
          // Show the user's turn immediately; the assistant reply streams in
          // via useChatStream and is reconciled on turn completion.
          if (res?.userMessage) {
            setBaseMessages((prev) => mergeChatMessages(prev, res.userMessage));
          }
        },
        onError: () => setPending(false), // POST failed — release the gate
      },
    );
  }

  function handleSend(text: string) {
    startTurn(text);
  }

  function handleStop() {
    stopTurn.mutate();
  }

  function handleModelSelect(provider: string, modelId: string) {
    const next: ChatModelSelection = { provider, model: modelId, thinkingLevel: model.thinkingLevel };
    setModel(next); // optimistic
    updateModel.mutate(next);
  }

  function handleThinkingSelect(level: ChatThinkingLevel) {
    const next: ChatModelSelection = { ...model, thinkingLevel: level };
    setModel(next); // optimistic
    updateModel.mutate(next);
  }

  function handleNewChat() {
    router.push("/chat");
  }

  function handleSelectThread(id: string) {
    router.push(`/chat/${id}`);
  }

  function handlePromptSelect(text: string) {
    startTurn(text);
  }

  // Auto-send a prompt passed via ?prompt= (from the landing-page composer or a
  // prompt card). Fires once: we strip the param after sending so a refresh or
  // re-render never re-sends it.
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current) return;
    const prompt = searchParams.get("prompt");
    if (!prompt) return;
    autoSentRef.current = true;
    startTurn(prompt);
    router.replace(`/chat/${thread.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, thread.id]);

  return (
    <div className="relative flex h-[100dvh] min-h-0 overflow-hidden">
      {/* Rail */}
      <div className="hidden w-[220px] flex-none lg:block">
        <ChatRail
          threads={threads}
          activeThreadId={activeThreadId}
          onNewChat={handleNewChat}
          onSelectThread={handleSelectThread}
        />
      </div>

      {/* Main chat area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Transcript or empty state */}
        {messages.length === 0 && !active ? (
          <div className="no-scrollbar flex-1 overflow-y-auto">
            <ChatEmptyState onPromptSelect={handlePromptSelect} />
          </div>
        ) : (
          <ChatTranscript
            messages={messages}
            streaming={stream.streaming}
            awaitingResponse={awaitingResponse}
          />
        )}

        {/* Composer — model + thinking pickers live inside the box (REQ-040/044) */}
        <ChatComposer
          streaming={active}
          onSend={handleSend}
          onStop={handleStop}
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
  );
}
