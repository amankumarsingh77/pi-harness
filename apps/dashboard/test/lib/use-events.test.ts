import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("useEvents", () => {
  it("appends incoming events to state", async () => {
    const { result } = renderHook(() => useEvents("run-1"));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit(JSON.stringify({ id: "1", kind: "log", level: "info", text: "hi" }));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]!.kind).toBe("log");
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
});
