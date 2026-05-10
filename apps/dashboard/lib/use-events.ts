"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@pi-harness/shared";

export type UseEventsResult = {
  events: AgentEvent[];
  connected: boolean;
};

// Subscribes to /api/sse/:runId and accumulates events. Reconnects on error
// with backoff; caller doesn't see disconnects unless they inspect
// `connected`.
//
// On the brainstorm page, do NOT call this directly — go through
// `useBrainstormEvents` (lib/brainstorm-events-context.tsx) so all widgets
// share one EventSource. Calling this in multiple sibling components on the
// same page opens one socket per call, which under HTTP/1.1 dev pins the
// browser's per-origin slots and starves the action POST + RSC refresh that
// fire on submit.
//
// `_diagLabel` is a free-form caller tag used for runtime diagnostics; it
// does not affect behaviour.
export function useEvents(
  runId: string | null,
  _diagLabel = "anon",
): UseEventsResult {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;
    let attempt = 0;
    let cancelled = false;

    const open = (): void => {
      if (cancelled) return;
      // Dedicated SSE route — passes req.signal to the upstream fetch so a
      // browser disconnect cleanly terminates the orchestrator-side request
      // instead of being torn down mid-pipe (which surfaces as a "failed to
      // pipe response" error in Next.js dev logs). The catch-all
      // /api/proxy/* path is for plain JSON; SSE has its own route.
      const es = new EventSource(`/api/sse/${runId}`);
      esRef.current = es;
      es.onopen = () => {
        setConnected(true);
        // Reset backoff only after a successful connection, so a stream
        // that lived for an hour and then dropped doesn't punish itself
        // with the same backoff curve as a stream that's never connected.
        attempt = 0;
      };
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
        // Exponential backoff (cap 8s) with ±20% jitter so multiple tabs
        // reconnecting after an orchestrator restart don't all reopen on
        // the same millisecond.
        const base = Math.min(8000, 500 * 2 ** attempt);
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        setTimeout(open, base + jitter);
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
