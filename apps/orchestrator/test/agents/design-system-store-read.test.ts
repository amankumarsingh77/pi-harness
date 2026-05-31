import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignSystemStore } from "../../src/agents/design-system-store.js";

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), "ds-store-"));
}

describe("DesignSystemStore reads", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = freshCwd();
  });

  it("returns an empty design system when nothing exists", async () => {
    const store = new DesignSystemStore({});
    const ds = await store.read(cwd);
    expect(ds.manifest.tokenVersion).toBe(0);
    expect(ds.tokensCss).toBe("");
    expect(ds.designMd).toBe("");
    expect(ds.exists).toBe(false);
  });

  it("reads tokens.css, DESIGN.md, and manifest when present", async () => {
    const dir = join(cwd, ".harness", "design");
    mkdirSync(join(dir, "gallery"), { recursive: true });
    writeFileSync(join(dir, "tokens.css"), ":root { --accent: #2563eb; }");
    writeFileSync(join(dir, "DESIGN.md"), "# Design\nMonochrome.");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({ tokenVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", exemplars: [], history: [] }),
    );
    const store = new DesignSystemStore({});
    const ds = await store.read(cwd);
    expect(ds.exists).toBe(true);
    expect(ds.manifest.tokenVersion).toBe(1);
    expect(ds.tokensCss).toContain("--accent: #2563eb");
    expect(ds.designMd).toContain("Monochrome");
  });
});
