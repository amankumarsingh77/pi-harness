import { describe, expect, it } from "vitest";
import type { PlanJsonlEvent } from "@/lib/api";
import type { PreflightStep } from "@pi-harness/shared";
import { deriveKind } from "@/components/plan/preflight-progress";

const subagent = "codebase-scout";

function started(sessionId: string, ts = "2026-05-12T20:00:00.000Z"): PlanJsonlEvent {
  return {
    kind: "plan_subagent_started",
    ts,
    subagent,
    sessionId,
  };
}

function ended(
  sessionId: string,
  ok: boolean,
  ts = "2026-05-12T20:01:00.000Z",
): PlanJsonlEvent {
  return {
    kind: "plan_subagent_ended",
    ts,
    subagent,
    sessionId,
    ok,
    durationMs: 1000,
    costUsd: 0.01,
    inputTokens: 100,
    outputTokens: 50,
  };
}

function research(body: string | null): Record<string, string | null> {
  return { [subagent]: body };
}

describe("deriveKind", () => {
  it("shows progress for a started attempt without a matching end", () => {
    expect(deriveKind(subagent, research(null), [started("s1")])).toBe("progress");
  });

  it("shows blocked when the latest attempt failed without findings", () => {
    expect(deriveKind(subagent, research(null), [started("s1"), ended("s1", false)])).toBe(
      "blocked",
    );
  });

  it("shows blocked when the latest attempt ended cleanly without findings", () => {
    expect(deriveKind(subagent, research(null), [started("s1"), ended("s1", true)])).toBe(
      "blocked",
    );
  });

  it("shows done when findings exist regardless of event history", () => {
    expect(deriveKind(subagent, research("# findings"), [started("s1")])).toBe("done");
  });

  it("uses the latest attempt instead of an older ended attempt", () => {
    const events = [
      started("s1", "2026-05-12T20:00:00.000Z"),
      ended("s1", false, "2026-05-12T20:01:00.000Z"),
      started("s2", "2026-05-12T20:02:00.000Z"),
    ];

    expect(deriveKind(subagent, research(null), events)).toBe("progress");
  });

  it("prefers durable fallback step state over legacy event-derived status", () => {
    const steps: PreflightStep[] = [
      {
        taskId: "task-1",
        runId: "run-1",
        attemptId: "attempt-1:fallback",
        subagent,
        status: "fallback_succeeded",
        required: false,
        artifactPath: "/tmp/codebase-scout.md",
        startedAt: new Date("2026-05-12T20:02:00.000Z"),
        endedAt: new Date("2026-05-12T20:03:00.000Z"),
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: "timed out",
        fallbackReason: "timed out",
      },
    ];

    expect(deriveKind(subagent, research("# fallback"), [started("s1")], steps)).toBe("fallback");
  });
});
