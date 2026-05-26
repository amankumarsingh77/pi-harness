import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEvents } from "@/lib/use-events";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Array<(ev: { data: string }) => void>>();
  readyState = 0;
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
    MockEventSource.instances.push(this);
  }
  emit(data: string) {
    this.onmessage?.({ data });
  }
  emitEvent(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  addEventListener(type: string, listener: (ev: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() { this.closed = true; }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error patch global
  globalThis.EventSource = MockEventSource;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useEvents", () => {
  it("appends incoming events to state", async () => {
    const { result } = renderHook(() => useEvents("run-1"));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emitEvent("agent.event.appended", liveEnvelope({ id: "1", kind: "log", level: "info", text: "hi" }));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]!.kind).toBe("log");
    expect(result.current.events[0]!.ts).toBeInstanceOf(Date);
  });

  it("dedupes replayed events by id", async () => {
    const { result } = renderHook(() => useEvents("run-1"));
    const es = MockEventSource.instances[0]!;
    const event = liveEnvelope({ id: "1", kind: "log", level: "info", text: "hi" });

    act(() => {
      es.emitEvent("agent.event.appended", event);
      es.emitEvent("agent.event.appended", event);
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
  });

  it("clears prior events when run id changes", async () => {
    const { result, rerender } = renderHook(({ runId }) => useEvents(runId), {
      initialProps: { runId: "run-1" as string | null },
    });
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emitEvent("agent.event.appended", liveEnvelope({ id: "1", kind: "log", level: "info", text: "old" }));
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ runId: "run-2" });
    await waitFor(() => expect(result.current.events).toHaveLength(0));
  });

  it("opens correct URL", () => {
    renderHook(() => useEvents("run-2"));
    const es = MockEventSource.instances[0]!;
    expect(es.url).toBe("/api/live/stream?runId=run-2");
  });

  it("encodes run ids through the shared live stream URL builder", () => {
    renderHook(() => useEvents("run 2"));
    const es = MockEventSource.instances[0]!;
    expect(es.url).toBe("/api/live/stream?runId=run+2");
  });

  it("exposes the latest event timestamp", async () => {
    const { result } = renderHook(() => useEvents("run-3"));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emitEvent("agent.event.appended", liveEnvelope({
        id: "1",
        runId: "run-3",
        taskId: "task-1",
        ts: "2026-05-15T10:00:00.000Z",
        kind: "log",
        level: "info",
        text: "hi",
      }));
    });

    await waitFor(() => {
      expect(result.current.lastEventAt?.toISOString()).toBe("2026-05-15T10:00:00.000Z");
    });
  });

  it("throttles last-event timestamp publishing to once per second", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEvents("run-4"));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emitEvent("agent.event.appended", liveEnvelope({
        id: "1",
        runId: "run-4",
        taskId: "task-1",
        ts: "2026-05-15T10:00:00.000Z",
        kind: "log",
        level: "info",
        text: "first",
      }));
      es.emitEvent("agent.event.appended", liveEnvelope({
        id: "2",
        runId: "run-4",
        taskId: "task-1",
        ts: "2026-05-15T10:00:00.500Z",
        kind: "log",
        level: "info",
        text: "second",
      }));
    });

    expect(result.current.lastEventAt?.toISOString()).toBe("2026-05-15T10:00:00.000Z");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.lastEventAt?.toISOString()).toBe("2026-05-15T10:00:00.500Z");
  });
});

function liveEnvelope(event: Record<string, unknown>): string {
  return JSON.stringify({
    id: `live-${event["id"]}`,
    sequence: Number(String(event["id"]).replace(/\D/g, "")) || 1,
    ts: event["ts"] ?? "2026-05-15T10:00:00.000Z",
    scope: "run",
    taskId: event["taskId"] ?? "task-1",
    runId: event["runId"] ?? "run-1",
    kind: "agent.event.appended",
    payload: {
      runId: event["runId"] ?? "run-1",
      taskId: event["taskId"] ?? "task-1",
      ts: event["ts"] ?? "2026-05-15T10:00:00.000Z",
      ...event,
    },
  });
}
