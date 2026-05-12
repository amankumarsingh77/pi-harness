import { describe, it, expect } from "vitest";
import { __testing } from "../../src/agents/plan.js";

const { hasReadyEvent, hasRevisionAfterReady, decidePlannerPrompt } = __testing;

const ev = (kind: string, extra: Record<string, unknown> = {}) => ({
  ts: new Date().toISOString(),
  kind,
  ...extra,
});

const ready = () => ev("plan_system", { systemKind: "status_changed", data: { status: "ready" } });
const revision = (comment = "fix x") => ev("plan_revision_requested", { comment });
const plannerStarted = () => ev("plan_system", { systemKind: "planner_started" });

describe("runPlan dispatch decision (regression: revision after ready)", () => {
  it("hasReadyEvent detects status_changed→ready", () => {
    expect(hasReadyEvent([ready()])).toBe(true);
    expect(hasReadyEvent([plannerStarted()])).toBe(false);
  });

  it("hasRevisionAfterReady is false when no revision exists", () => {
    expect(hasRevisionAfterReady([plannerStarted(), ready()])).toBe(false);
  });

  it("hasRevisionAfterReady is true only when revision postdates ready", () => {
    expect(hasRevisionAfterReady([revision(), ready()])).toBe(false); // revision before ready
    expect(hasRevisionAfterReady([ready(), revision()])).toBe(true); // revision after ready
  });

  it("decidePlannerPrompt picks revision when revision postdates ready", () => {
    const decision = decidePlannerPrompt([plannerStarted(), ready(), revision("re-audit please")]);
    expect(decision.kind).toBe("revision");
    if (decision.kind === "revision") {
      expect(decision.prompt).toContain("re-audit please");
    }
  });

  it("decidePlannerPrompt is noop when ready is current and no new revision", () => {
    const decision = decidePlannerPrompt([plannerStarted(), ready()]);
    expect(decision.kind).toBe("noop");
  });
});
