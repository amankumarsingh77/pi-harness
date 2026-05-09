import { describe, it, expect } from "vitest";
import {
  resolveAgentPath,
  listVendoredAgents,
  EXPECTED_VENDORED_AGENTS,
  listOurAgents,
  EXPECTED_OUR_AGENTS,
} from "../index.js";
import { existsSync } from "node:fs";

describe("subagent loader", () => {
  it("lists 13 vendored agents", () => {
    const agents = listVendoredAgents();
    expect(agents).toHaveLength(13);
    for (const name of EXPECTED_VENDORED_AGENTS) {
      expect(agents).toContain(name);
    }
  });

  it("resolveAgentPath returns an existing file for a vendored agent", () => {
    const p = resolveAgentPath("codebase-locator");
    expect(p).toMatch(/_vendored\/codebase-locator\.md$/);
    expect(existsSync(p)).toBe(true);
  });

  it("resolveAgentPath throws for an unknown agent", () => {
    expect(() => resolveAgentPath("does-not-exist")).toThrow(/unknown agent/i);
  });
});

describe("ours/ resolution", () => {
  it("resolves verification-author from ours/", () => {
    const p = resolveAgentPath("verification-author");
    expect(p).toContain("ours/verification-author.md");
    expect(existsSync(p)).toBe(true);
  });

  it("listOurAgents includes the three new agents", () => {
    const list = listOurAgents().sort();
    expect(list).toEqual(EXPECTED_OUR_AGENTS.slice().sort());
  });
});
