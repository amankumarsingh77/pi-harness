"use client";
import { type ReactNode } from "react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentEvent } from "@pi-harness/shared";
import { queryKeys } from "./client/queries";
import { RunLiveProvider, useRunLiveEvents } from "./run-live-provider";

// Single SSE subscription shared by every component on the plan page.
// Mirrors brainstorm-events-context: the per-agent drawer + the bottom
// planner log panel both need the live event stream, and useEvents warns
// against opening multiple EventSources per page. One provider, one socket.

export function PlanEventsProvider({
  runId,
  initialEvents = [],
  children,
}: {
  runId: string | null;
  initialEvents?: readonly AgentEvent[];
  children: ReactNode;
}) {
  return (
    <RunLiveProvider runId={runId} initialEvents={initialEvents}>
      <PlanBundleInvalidator>{children}</PlanBundleInvalidator>
    </RunLiveProvider>
  );
}

function PlanBundleInvalidator({ children }: { readonly children: ReactNode }) {
  const { events } = useRunLiveEvents();
  const queryClient = useQueryClient();

  useEffect(() => {
    const latest = events.at(-1);
    if (!latest || !isPlanBundleEvent(latest)) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.planBundle(latest.taskId),
    });
  }, [events, queryClient]);

  return <>{children}</>;
}

function isPlanBundleEvent(e: AgentEvent): boolean {
  return e.kind.startsWith("plan_");
}

export function usePlanEvents() {
  return useRunLiveEvents();
}
