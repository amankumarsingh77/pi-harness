import { describe, expect, it } from "vitest";
import {
  DesignSystemManifestSchema,
  TokenDiffSchema,
  emptyManifest,
} from "../../src/agents/design-system-types.js";

describe("design-system-types", () => {
  it("emptyManifest is a valid manifest at version 0", () => {
    const m = emptyManifest();
    expect(m.tokenVersion).toBe(0);
    expect(m.exemplars).toEqual([]);
    expect(() => DesignSystemManifestSchema.parse(m)).not.toThrow();
  });

  it("rejects a manifest with a negative token version", () => {
    expect(() =>
      DesignSystemManifestSchema.parse({ tokenVersion: -1, updatedAt: "x", exemplars: [], history: [] }),
    ).toThrow();
  });

  it("parses a token diff with added and changed entries", () => {
    const diff = {
      fromVersion: 2,
      toVersion: 3,
      summary: "tighten accent",
      changes: [
        { name: "--accent", before: "#3b82f6", after: "#2563eb" },
        { name: "--surface-2", before: null, after: "#f5f5f4" },
      ],
      designMdDelta: "Accent darkened for contrast.",
    };
    expect(() => TokenDiffSchema.parse(diff)).not.toThrow();
  });
});
