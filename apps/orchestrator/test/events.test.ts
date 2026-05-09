import { describe, it, expect } from "vitest";
import { mkEvent } from "../src/domain/events.js";

describe("mkEvent", () => {
  it("phase_started carries phase", () => {
    const e = mkEvent({ runId: "r1", taskId: "t1", kind: "phase_started", phase: "code" });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.kind).toBe("phase_started");
    if (e.kind === "phase_started") expect(e.phase).toBe("code");
    expect(e.ts).toBeInstanceOf(Date);
  });

  it("tool_call carries tool + input", () => {
    const e = mkEvent({
      runId: "r1",
      taskId: "t1",
      kind: "tool_call",
      tool: "Read",
      input: { path: "x" },
    });
    expect(e.kind).toBe("tool_call");
  });

  it("log requires level + text", () => {
    const e = mkEvent({ runId: "r1", taskId: "t1", kind: "log", level: "info", text: "hi" });
    expect(e.kind).toBe("log");
  });
});
