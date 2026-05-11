import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  SUBAGENTS,
  PREFLIGHT_SUBAGENTS,
  RETIRED_PROMPTS,
  getSubagent,
  listVendoredAgents,
  listOurAgents,
} from "../index.js";

describe("subagent registry", () => {
  it("every registered subagent's promptPath exists on disk", () => {
    for (const def of Object.values(SUBAGENTS)) {
      expect(existsSync(def.promptPath), `${def.name}: ${def.promptPath}`).toBe(
        true,
      );
    }
  });

  it("every .md on disk is either registered or explicitly retired", () => {
    const onDisk = new Set([...listVendoredAgents(), ...listOurAgents()]);
    const accounted = new Set<string>([
      ...Object.keys(SUBAGENTS),
      ...RETIRED_PROMPTS,
    ]);
    const orphans = [...onDisk].filter((n) => !accounted.has(n));
    expect(orphans, `unaccounted prompts: ${orphans.join(", ")}`).toEqual([]);
  });

  it("PREFLIGHT_SUBAGENTS is the derived view over preflight-research role", () => {
    const expected = Object.values(SUBAGENTS)
      .filter((s) => s.role === "preflight-research")
      .map((s) => s.name);
    expect([...PREFLIGHT_SUBAGENTS]).toEqual(expected);
  });

  it("getSubagent returns the def for a known name", () => {
    const def = getSubagent("codebase-scout");
    expect(def.name).toBe("codebase-scout");
    expect(def.role).toBe("preflight-research");
  });

  it("getSubagent throws for unknown name", () => {
    expect(() => getSubagent("does-not-exist")).toThrow(/unknown subagent/i);
  });
});
