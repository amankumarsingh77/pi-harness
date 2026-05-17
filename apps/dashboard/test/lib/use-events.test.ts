import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEvents } from "@/lib/use-events";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
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
      es.emit(JSON.stringify({ id: "1", kind: "log", level: "info", text: "hi" }));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]!.kind).toBe("log");
    expect(result.current.events[0]!.ts).toBeInstanceOf(Date);
  });

  it("dedupes replayed events by id", async () => {
    const { result } = renderHook(() => useEvents("run-1"));
    const es = MockEventSource.instances[0]!;
    const event = JSON.stringify({ id: "1", kind: "log", level: "info", text: "hi" });

    act(() => {
      es.emit(event);
      es.emit(event);
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
  });

  it("clears prior events when run id changes", async () => {
    const { result, rerender } = renderHook(({ runId }) => useEvents(runId), {
      initialProps: { runId: "run-1" as string | null },
    });
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit(JSON.stringify({ id: "1", kind: "log", level: "info", text: "old" }));
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ runId: "run-2" });
    await waitFor(() => expect(result.current.events).toHaveLength(0));
  });

  it("opens correct URL", () => {
    renderHook(() => useEvents("run-2"));
    const es = MockEventSource.instances[0]!;
    expect(es.url).toBe("/api/sse/run-2");
  });

  it("exposes the latest event timestamp", async () => {
    const { result } = renderHook(() => useEvents("run-3"));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit(JSON.stringify({
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
      es.emit(JSON.stringify({
        id: "1",
        runId: "run-4",
        taskId: "task-1",
        ts: "2026-05-15T10:00:00.000Z",
        kind: "log",
        level: "info",
        text: "first",
      }));
      es.emit(JSON.stringify({
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
