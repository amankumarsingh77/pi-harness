import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  SUBAGENTS,
  PLAN_RESEARCH_SUBAGENTS,
  getSubagent,
  listPromptAgents,
} from "../index.js";

describe("subagent registry", () => {
  it("every registered subagent's promptPath exists on disk", () => {
    for (const def of Object.values(SUBAGENTS)) {
      expect(existsSync(def.promptPath), `${def.name}: ${def.promptPath}`).toBe(
        true,
      );
    }
  });

  it("every .md prompt on disk is registered", () => {
    const onDisk = new Set(listPromptAgents());
    const accounted = new Set<string>(Object.keys(SUBAGENTS));
    const orphans = [...onDisk].filter((n) => !accounted.has(n));
    expect(orphans, `unaccounted prompts: ${orphans.join(", ")}`).toEqual([]);
  });

  it("PLAN_RESEARCH_SUBAGENTS is the derived view over planner-spawned research roles", () => {
    const expected = Object.values(SUBAGENTS)
      .filter((s) => s.role === "plan-research")
      .map((s) => s.name);
    expect([...PLAN_RESEARCH_SUBAGENTS]).toEqual(expected);
  });

  it("does not register automatic preflight research roles", () => {
    expect(Object.values(SUBAGENTS).map((def) => def.role)).not.toContain(
      "preflight-research",
    );
  });

  it("getSubagent returns the def for a known name", () => {
    const def = getSubagent("codebase-scout");
    expect(def.name).toBe("codebase-scout");
    expect(def.role).toBe("plan-research");
  });

  it("codebase-scout prompt directs graph-backed discovery before grep fallback", () => {
    const def = getSubagent("codebase-scout");
    const prompt = readFileSync(def.promptPath, "utf8");

    expect(prompt).toMatch(/Graphify-first/i);
    expect(prompt).toContain("graphify_query");
    expect(prompt).toContain("graphify_path");
    expect(prompt).toContain("graphify_explain");
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

  it("planner cannot use the generic write tool", () => {
    const def = getSubagent("plan");
    expect(def.allowedTools).toEqual(["read", "grep", "find"]);
    expect(def.customTools).toContain("spawn_plan_agent");
    expect(def.customTools).toContain("write_plan_artifact");
    expect(def.customTools).toContain("mark_ready");
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
