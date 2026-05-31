import { describe, expect, it } from "vitest";
import { BRAINSTORM_EVENT_KINDS } from "../../src/adapters/phase-event-log-store.js";

describe("brainstorm event kinds", () => {
  it("includes brainstorm_design_promoted", () => {
    expect(BRAINSTORM_EVENT_KINDS).toContain("brainstorm_design_promoted");
  });
});
