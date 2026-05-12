"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentEvent } from "@pi-harness/shared";
import { useEvents } from "./use-events";
import { queryKeys } from "./client/queries";

// Single SSE subscription shared by every component on the plan page.
// Mirrors brainstorm-events-context: the per-agent drawer + the bottom
// planner log panel both need the live event stream, and useEvents warns
// against opening multiple EventSources per page. One provider, one socket.

type Ctx = {
  events: AgentEvent[];
  connected: boolean;
};

const PlanEventsContext = createContext<Ctx | null>(null);

export function PlanEventsProvider({
  runId,
  children,
}: {
  runId: string | null;
  children: ReactNode;
}) {
  const { events, connected } = useEvents(runId, "PlanPage");
  const queryClient = useQueryClient();

  useEffect(() => {
    const latest = events.at(-1);
    if (!latest || !isPlanBundleEvent(latest)) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.planBundle(latest.taskId),
    });
  }, [events, queryClient]);

  return (
    <PlanEventsContext.Provider value={{ events, connected }}>
      {children}
    </PlanEventsContext.Provider>
  );
}

function isPlanBundleEvent(e: AgentEvent): boolean {
  return e.kind.startsWith("plan_");
}

export function usePlanEvents(): Ctx {
  const ctx = useContext(PlanEventsContext);
  if (ctx === null) {
    throw new Error(
      "usePlanEvents must be used inside <PlanEventsProvider>",
    );
  }
  return ctx;
}
