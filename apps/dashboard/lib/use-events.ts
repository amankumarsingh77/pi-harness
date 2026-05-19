"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { AgentEvent, LiveEventEnvelope } from "@pi-harness/shared";

export type UseEventsResult = {
  events: AgentEvent[];
  connected: boolean;
  lastEventId: string | null;
  lastEventAt: Date | null;
  gapDetected: boolean;
};

// Subscribes to /api/live/stream?runId=:runId and accumulates agent events.
// The browser's EventSource handles reconnect + Last-Event-ID resume.
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
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [gapDetected, setGapDetected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const lastPublishedAtRef = useRef<number | null>(null);
  const pendingLastEventAtRef = useRef<Date | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    setLastEventId(null);
    setLastEventAt(null);
    setGapDetected(false);
    seenRef.current = new Set();
    lastPublishedAtRef.current = null;
    pendingLastEventAtRef.current = null;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;

    if (!runId) return;
    let cancelled = false;

    const open = (): void => {
      if (cancelled) return;
      const es = new EventSource(`/api/live/stream?runId=${encodeURIComponent(runId)}`);
      esRef.current = es;
      es.onopen = () => {
        setConnected(true);
      };
      const onAgentEvent = (ev: MessageEvent<string>) => {
        try {
          const envelope = parseAgentEventEnvelope(ev.data);
          if (!envelope) {
            setGapDetected(true);
            return;
          }
          const parsed = hydrateEvent(envelope.payload);
          setLastEventId(String(envelope.sequence));
          setEvents((curr) => {
            if (seenRef.current.has(parsed.id)) return curr;
            seenRef.current.add(parsed.id);
            return [...curr, parsed].sort(
              (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
            );
          });
          publishLastEventAtThrottled(parsed.ts, {
            lastPublishedAtRef,
            pendingLastEventAtRef,
            pendingTimerRef,
            setLastEventAt,
          });
        } catch {
          setGapDetected(true);
        }
      };
      es.addEventListener("agent.event.appended", onAgentEvent);
      es.onerror = () => {
        setConnected(false);
      };
    };
    open();

    return () => {
      cancelled = true;
      esRef.current?.close();
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    };
  }, [runId]);

  return { events, connected, lastEventId, lastEventAt, gapDetected };
}

type LastEventThrottle = {
  lastPublishedAtRef: MutableRefObject<number | null>;
  pendingLastEventAtRef: MutableRefObject<Date | null>;
  pendingTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setLastEventAt: Dispatch<SetStateAction<Date | null>>;
};

function publishLastEventAtThrottled(
  next: Date,
  throttle: LastEventThrottle,
): void {
  const now = Date.now();
  const lastPublishedAt = throttle.lastPublishedAtRef.current;
  const elapsed = lastPublishedAt === null ? 1000 : now - lastPublishedAt;
  if (elapsed >= 1000) {
    throttle.lastPublishedAtRef.current = now;
    throttle.setLastEventAt(next);
    return;
  }

  throttle.pendingLastEventAtRef.current = next;
  if (throttle.pendingTimerRef.current) return;

  throttle.pendingTimerRef.current = setTimeout(() => {
    throttle.pendingTimerRef.current = null;
    throttle.lastPublishedAtRef.current = Date.now();
    throttle.setLastEventAt(throttle.pendingLastEventAtRef.current);
    throttle.pendingLastEventAtRef.current = null;
  }, 1000 - elapsed);
}

function toEventDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function hydrateEvent(event: AgentEvent): AgentEvent {
  return { ...event, ts: toEventDate(event.ts) };
}

function parseAgentEventEnvelope(raw: string): LiveEventEnvelope<"agent.event.appended"> | null {
  const value = JSON.parse(raw) as LiveEventEnvelope;
  return value.kind === "agent.event.appended"
    ? value as LiveEventEnvelope<"agent.event.appended">
    : null;
}
