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

  it("opens correct URL", () => {
    renderHook(() => useEvents("run-2"));
    const es = MockEventSource.instances[0]!;
    expect(es.url).toBe("/api/proxy/runs/run-2/events/stream");
  });
});
