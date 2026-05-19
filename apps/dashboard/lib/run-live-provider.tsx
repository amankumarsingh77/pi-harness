"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentEvent } from "@pi-harness/shared";
import { useEvents } from "./use-events";

type RunLiveContextValue = {
  readonly events: AgentEvent[];
  readonly connected: boolean;
  readonly lastEventAt: Date | null;
};

const RunLiveContext = createContext<RunLiveContextValue | null>(null);

export function RunLiveProvider({
  runId,
  initialEvents = [],
  children,
}: {
  readonly runId: string | null;
  readonly initialEvents?: readonly AgentEvent[];
  readonly children: ReactNode;
}) {
  const live = useEvents(runId, "RunLiveProvider");
  const events = useMemo(
    () => mergeEvents(initialEvents, live.events),
    [initialEvents, live.events],
  );
  return (
    <RunLiveContext.Provider
      value={{ events, connected: live.connected, lastEventAt: live.lastEventAt }}
    >
      {children}
    </RunLiveContext.Provider>
  );
}

export function useRunLiveEvents(): RunLiveContextValue {
  const ctx = useContext(RunLiveContext);
  if (ctx === null) {
    throw new Error("useRunLiveEvents must be used inside <RunLiveProvider>");
  }
  return ctx;
}

export function useOptionalRunLiveEvents(): RunLiveContextValue | null {
  return useContext(RunLiveContext);
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
