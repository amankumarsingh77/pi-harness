import { describe, it, expect } from "vitest";
import { ArtifactKindSchema } from "./artifact.js";

describe("ArtifactKindSchema", () => {
  it.each(["design", "spec", "plan", "phase-plan", "scenarios", "blast-radius", "execution-dag"] as const)("accepts %s", (k) => {
    expect(ArtifactKindSchema.parse(k)).toBe(k);
  });

  it("rejects unknown kinds", () => {
    expect(() => ArtifactKindSchema.parse("garbage")).toThrow();
  });
});
