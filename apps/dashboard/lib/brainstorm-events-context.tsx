"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentEvent } from "@pi-harness/shared";
import { useEvents } from "./use-events";
import { queryKeys } from "./client/queries";

// Single SSE subscription shared by every component on the brainstorm page.
//
// Multiple brainstorm widgets (ChatPanel, ArtifactPane via the activity
// hook, etc.) all watch the same runId. With each calling useEvents
// directly, the page opened multiple EventSource connections and accumulated
// independent copies of the event list — every incoming event
// triggered multiple React re-renders, each over a separate growing array. In
// HTTP/1.1 dev that also pinned three of the browser's six per-origin
// sockets, leaving no headroom for the action POST + RSC refresh that fire
// on submit.
//
// Lifting the subscription here means one EventSource, one events array,
// one set of reconnect timers per page.

type Ctx = {
  events: AgentEvent[];
  connected: boolean;
};

const BrainstormEventsContext = createContext<Ctx | null>(null);

export function BrainstormEventsProvider({
  runId,
  children,
}: {
  runId: string | null;
  children: ReactNode;
}) {
  const { events, connected } = useEvents(runId, "BrainstormPage");
  const queryClient = useQueryClient();

  useEffect(() => {
    const latest = events.at(-1);
    if (!latest || !isBrainstormBundleEvent(latest)) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.brainstormBundle(latest.taskId),
    });
  }, [events, queryClient]);

  return (
    <BrainstormEventsContext.Provider value={{ events, connected }}>
      {children}
    </BrainstormEventsContext.Provider>
  );
}

function isBrainstormBundleEvent(e: AgentEvent): boolean {
  return e.kind.startsWith("brainstorm_");
}

// Consumer hook. Throws if used outside the provider — callers on the
// brainstorm page are always wrapped, and accidental misuse on another page
// should fail loudly rather than silently open a new EventSource.
export function useBrainstormEvents(): Ctx {
  const ctx = useContext(BrainstormEventsContext);
  if (ctx === null) {
    throw new Error(
      "useBrainstormEvents must be used inside <BrainstormEventsProvider>",
    );
  }
  return ctx;
}
