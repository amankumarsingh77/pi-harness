import { describe, expect, it } from "vitest";
import { findTokenViolations } from "../../src/agents/token-conformance.js";

describe("findTokenViolations", () => {
  it("passes HTML that uses var() for core properties", () => {
    const html = `<style>.a{color:var(--fg);background-color:var(--bg);font-family:var(--font-display);}</style>`;
    expect(findTokenViolations(html)).toEqual([]);
  });

  it("flags a hard-coded hex color on a core property", () => {
    const html = `<style>.a{color:#ff0000;}</style>`;
    const v = findTokenViolations(html);
    expect(v).toHaveLength(1);
    expect(v[0].property).toBe("color");
    expect(v[0].value).toBe("#ff0000");
  });

  it("flags a hard-coded font-family and background-color", () => {
    const html = `<style>.a{background-color:rgb(0,0,0);font-family:Arial,sans-serif;}</style>`;
    const props = findTokenViolations(html).map((x) => x.property).sort();
    expect(props).toEqual(["background-color", "font-family"]);
  });

  it("does not flag non-core properties like border-radius", () => {
    const html = `<style>.a{border-radius:8px;color:var(--fg);}</style>`;
    expect(findTokenViolations(html)).toEqual([]);
  });
});
