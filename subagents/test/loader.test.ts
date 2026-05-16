import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
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

  it("registered prompt frontmatter tools match registry tools", () => {
    for (const def of Object.values(SUBAGENTS)) {
      const prompt = readFileSync(def.promptPath, "utf8");
      const tools = parseFrontmatterTools(prompt);
      expect(tools, def.name).toEqual([
        ...def.allowedTools,
        ...(def.customTools ?? []),
      ]);
    }
  });

  it("retired prompts are explicitly marked retired", () => {
    for (const name of RETIRED_PROMPTS) {
      const path = [...listVendoredAgents(), ...listOurAgents()].includes(name)
        ? promptPathFor(name)
        : null;
      expect(path, name).not.toBeNull();
      const prompt = readFileSync(path!, "utf8");
      expect(prompt, name).toMatch(/retired prompt/i);
    }
  });
});

function parseFrontmatterTools(prompt: string): string[] {
  const match = prompt.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  const toolsLine = match[1]!
    .split("\n")
    .find((line) => line.startsWith("tools:"));
  if (!toolsLine) return [];
  return toolsLine
    .replace(/^tools:\s*/, "")
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

function promptPathFor(name: string): string {
  const registered = SUBAGENTS[name];
  if (registered) return registered.promptPath;
  const vendored = `${import.meta.dirname}/../_vendored/${name}.md`;
  if (existsSync(vendored)) return vendored;
  return `${import.meta.dirname}/../ours/${name}.md`;
}
