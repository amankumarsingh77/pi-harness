"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
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
  initialEvents = [],
  children,
}: {
  runId: string | null;
  initialEvents?: readonly AgentEvent[];
  children: ReactNode;
}) {
  const { events: liveEvents, connected } = useEvents(runId, "PlanPage");
  const events = useMemo(
    () => mergeEvents(initialEvents, liveEvents),
    [initialEvents, liveEvents],
  );
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

function mergeEvents(
  initialEvents: readonly AgentEvent[],
  liveEvents: readonly AgentEvent[],
): AgentEvent[] {
  const byId = new Map<string, AgentEvent>();
  for (const event of initialEvents) byId.set(event.id, hydrateEvent(event));
  for (const event of liveEvents) byId.set(event.id, hydrateEvent(event));
  return [...byId.values()].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  );
}

function hydrateEvent(event: AgentEvent): AgentEvent {
  return {
    ...event,
    ts: event.ts instanceof Date ? event.ts : new Date(event.ts),
  };
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
