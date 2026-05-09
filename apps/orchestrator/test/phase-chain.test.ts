import { describe, it, expect } from "vitest";
import { phasesFor, nextPhase, isLastPhase } from "../src/domain/phase-chain.js";

describe("phase-chain", () => {
  it("backend-feature has the canonical 5-phase chain", () => {
    expect(phasesFor("backend-feature")).toEqual([
      "brainstorm",
      "plan",
      "code",
      "verify",
      "pr",
    ]);
  });

  it("nextPhase returns the next phase", () => {
    expect(nextPhase("backend-feature", "brainstorm")).toBe("plan");
    expect(nextPhase("backend-feature", "code")).toBe("verify");
  });

  it("nextPhase returns null after pr", () => {
    expect(nextPhase("backend-feature", "pr")).toBeNull();
  });

  it("isLastPhase identifies pr as terminal", () => {
    expect(isLastPhase("backend-feature", "pr")).toBe(true);
    expect(isLastPhase("backend-feature", "verify")).toBe(false);
  });

  it("nextPhase throws for unknown phase", () => {
    // @ts-expect-error testing runtime guard
    expect(() => nextPhase("backend-feature", "garbage")).toThrow();
  });
});
