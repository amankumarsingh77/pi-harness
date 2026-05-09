"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@pi-harness/shared";

export type UseEventsResult = {
  events: AgentEvent[];
  connected: boolean;
};

// Subscribes to /api/proxy/runs/:runId/events/stream and accumulates events.
// Reconnects on error with backoff; caller doesn't see disconnects unless they
// inspect `connected`.
export function useEvents(runId: string | null): UseEventsResult {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;
    let attempt = 0;
    let cancelled = false;

    const open = (): void => {
      if (cancelled) return;
      const es = new EventSource(`/api/proxy/runs/${runId}/events/stream`);
      esRef.current = es;
      setConnected(true);
      attempt = 0;
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as AgentEvent;
          setEvents((curr) => [...curr, parsed]);
        } catch {
          // ignore non-JSON keep-alives
        }
      };
      es.onerror = () => {
        es.close();
        setConnected(false);
        attempt++;
        const delay = Math.min(8000, 500 * 2 ** attempt);
        setTimeout(open, delay);
      };
    };
    open();

    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [runId]);

  return { events, connected };
}
