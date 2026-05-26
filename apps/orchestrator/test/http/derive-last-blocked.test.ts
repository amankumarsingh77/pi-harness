import { describe, it, expect } from "vitest";
import { deriveLastBlocked } from "../../src/http/routes/plan.js";

describe("deriveLastBlocked", () => {
  it("returns null when no events are recorded", () => {
    expect(deriveLastBlocked([])).toBeNull();
  });

  it("returns null when no blocked event was ever published", () => {
    const events = [
      { kind: "plan_system", systemKind: "preflight_started", ts: "2026-05-21T00:00:00Z" },
      { kind: "plan_system", systemKind: "planner_started", ts: "2026-05-21T00:01:00Z" },
    ];
    expect(deriveLastBlocked(events)).toBeNull();
  });

  it("surfaces the latest blocked reason", () => {
    const events = [
      {
        kind: "plan_system",
        systemKind: "blocked",
        ts: "2026-05-21T00:01:00Z",
        data: { reason: "planner timed out after 300000ms" },
      },
    ];
    expect(deriveLastBlocked(events)).toEqual({
      reason: "planner timed out after 300000ms",
      ts: "2026-05-21T00:01:00Z",
    });
  });

  it("clears the banner when a later status_changed: ready supersedes the block", () => {
    const events = [
      {
        kind: "plan_system",
        systemKind: "blocked",
        ts: "2026-05-21T00:01:00Z",
        data: { reason: "transient failure" },
      },
      {
        kind: "plan_system",
        systemKind: "status_changed",
        ts: "2026-05-21T00:02:00Z",
        data: { status: "ready" },
      },
    ];
    expect(deriveLastBlocked(events)).toBeNull();
  });

  it("clears the banner when a later session_reset supersedes the block", () => {
    const events = [
      {
        kind: "plan_system",
        systemKind: "blocked",
        ts: "2026-05-21T00:01:00Z",
        data: { reason: "claim-verifier exhausted" },
      },
      {
        kind: "plan_system",
        systemKind: "session_reset",
        ts: "2026-05-21T00:05:00Z",
        data: { archivedRunId: "r-1" },
      },
    ];
    expect(deriveLastBlocked(events)).toBeNull();
  });

  it("returns the newer reason when multiple blocks fire without an intervening ready", () => {
    const events = [
      {
        kind: "plan_system",
        systemKind: "blocked",
        ts: "2026-05-21T00:01:00Z",
        data: { reason: "first failure" },
      },
      {
        kind: "plan_system",
        systemKind: "blocked",
        ts: "2026-05-21T00:03:00Z",
        data: { reason: "second failure" },
      },
    ];
    expect(deriveLastBlocked(events)).toEqual({
      reason: "second failure",
      ts: "2026-05-21T00:03:00Z",
    });
  });

  it("handles a missing reason string gracefully", () => {
    const events = [
      {
        kind: "plan_system",
        systemKind: "blocked",
        ts: "2026-05-21T00:01:00Z",
        data: {},
      },
    ];
    expect(deriveLastBlocked(events)).toEqual({
      reason: "",
      ts: "2026-05-21T00:01:00Z",
    });
  });
});
