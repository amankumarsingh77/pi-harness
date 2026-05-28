import { describe, expect, it } from "vitest";
import type { AgentEvent, LiveEventEnvelope } from "@pi-harness/shared";
import {
  buildLiveStreamUrl,
  mergeLiveEnvelopes,
  parseLiveEnvelope,
} from "@/lib/live-event-client";

type LogAgentEvent = Extract<AgentEvent, { kind: "log" }>;

describe("live-event-client", () => {
  it("builds exactly one stream filter into the SSE URL", () => {
    expect(buildLiveStreamUrl({ scope: "dashboard" })).toBe("/api/live/stream?scope=dashboard");
    expect(buildLiveStreamUrl({ taskId: "T 1" })).toBe("/api/live/stream?taskId=T+1");
    expect(buildLiveStreamUrl({ runId: "run-1" })).toBe("/api/live/stream?runId=run-1");
    expect(buildLiveStreamUrl({ runId: "run-1" }, { afterSequence: 42 })).toBe(
      "/api/live/stream?runId=run-1&after=42",
    );
  });

  it("parses only the requested event kind", () => {
    const raw = JSON.stringify(envelope("agent.event.appended", agentPayload({ id: "event-1" })));

    expect(parseLiveEnvelope(raw, "agent.event.appended")?.kind).toBe("agent.event.appended");
    expect(parseLiveEnvelope(raw, "task.updated")).toBeNull();
    expect(parseLiveEnvelope("{bad", "agent.event.appended")).toBeNull();
  });

  it("hydrates envelope timestamps into Date values", () => {
    const parsed = parseLiveEnvelope(
      JSON.stringify(envelope("agent.event.appended", agentPayload({
        id: "event-1",
        ts: new Date("2026-05-21T00:00:01.000Z"),
      }))),
      "agent.event.appended",
    );

    expect(parsed?.ts).toBeInstanceOf(Date);
    expect(parsed?.payload.ts).toBeInstanceOf(Date);
  });

  it("hydrates graphify status update timestamps into Date values", () => {
    const parsed = parseLiveEnvelope(
      JSON.stringify(envelope("graphify.status.updated", {
        status: "installing",
        reason: "missing_cli",
        message: "Graphify CLI not found",
        updatedAt: "2026-05-21T00:00:02.000Z" as unknown as Date,
      })),
      "graphify.status.updated",
    );

    expect(parsed?.ts).toBeInstanceOf(Date);
    expect(parsed?.payload.updatedAt).toBeInstanceOf(Date);
  });

  it("dedupes and sorts envelopes by sequence", () => {
    const first = envelope("agent.event.appended", agentPayload({ id: "event-1" }), 2);
    const second = envelope("agent.event.appended", agentPayload({ id: "event-2" }), 1);

    expect(mergeLiveEnvelopes([first], [first, second]).map((event) => event.sequence)).toEqual([1, 2]);
  });
});

function envelope<K extends LiveEventEnvelope["kind"]>(
  kind: K,
  payload: LiveEventEnvelope<K>["payload"],
  sequence = 1,
): LiveEventEnvelope<K> {
  return {
    id: `live-${sequence}`,
    sequence,
    ts: new Date("2026-05-21T00:00:00.000Z"),
    scope: "run",
    taskId: "task-1",
    runId: "run-1",
    kind,
    payload,
  };
}

function agentPayload(overrides: Partial<LogAgentEvent>): LogAgentEvent {
  return {
    id: "event-default",
    runId: "run-1",
    taskId: "task-1",
    ts: new Date("2026-05-21T00:00:00.000Z"),
    kind: "log",
    level: "info",
    text: "hello",
    ...overrides,
  };
}
