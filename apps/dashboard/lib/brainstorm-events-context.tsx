"use client";
import { type ReactNode } from "react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentEvent } from "@pi-harness/shared";
import { queryKeys } from "./client/queries";
import { RunLiveProvider, useRunLiveEvents } from "./run-live-provider";

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

export function BrainstormEventsProvider({
  runId,
  children,
}: {
  runId: string | null;
  children: ReactNode;
}) {
  return (
    <RunLiveProvider runId={runId}>
      <BrainstormBundleInvalidator>{children}</BrainstormBundleInvalidator>
    </RunLiveProvider>
  );
}

function BrainstormBundleInvalidator({ children }: { readonly children: ReactNode }) {
  const { events } = useRunLiveEvents();
  const queryClient = useQueryClient();

  useEffect(() => {
    const latest = events.at(-1);
    if (!latest || !isBrainstormBundleEvent(latest)) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.brainstormBundle(latest.taskId),
    });
  }, [events, queryClient]);

  return <>{children}</>;
}

function isBrainstormBundleEvent(e: AgentEvent): boolean {
  return e.kind.startsWith("brainstorm_");
}

// Consumer hook. Throws if used outside the provider — callers on the
// brainstorm page are always wrapped, and accidental misuse on another page
// should fail loudly rather than silently open a new EventSource.
export function useBrainstormEvents() {
  return useRunLiveEvents();
}
