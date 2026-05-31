import { describe, expect, it } from "vitest";
import { distillTokensStub } from "../../src/agents/promote-distill.js";
import { TokenDiffSchema } from "../../src/agents/design-system-types.js";

describe("distillTokensStub", () => {
  it("produces a schema-valid diff bumping fromVersion to fromVersion+1", () => {
    const diff = distillTokensStub({
      mockHtml: "<style>.a{color:#2563eb;background-color:#ffffff;}</style>",
      currentTokensCss: ":root{--accent:#3b82f6;}",
      fromVersion: 2,
      title: "Settings",
    });
    expect(() => TokenDiffSchema.parse(diff)).not.toThrow();
    expect(diff.fromVersion).toBe(2);
    expect(diff.toVersion).toBe(3);
    expect(diff.changes.length).toBeGreaterThan(0);
    expect(diff.summary).toContain("Settings");
  });
});
