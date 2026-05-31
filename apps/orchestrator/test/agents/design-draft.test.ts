import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignSystemStore } from "../../src/agents/design-system-store.js";

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), "ds-draft-"));
}

describe("design draft (task-local)", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = freshCwd();
  });

  it("writes and reads task-local draft tokens", async () => {
    const store = new DesignSystemStore({});
    await store.writeDraftTokens(cwd, "t_1", ":root{--accent:#abc;}");
    expect(await store.readDraftTokens(cwd, "t_1")).toContain("--accent:#abc");
  });

  it("returns empty string when no draft exists", async () => {
    const store = new DesignSystemStore({});
    expect(await store.readDraftTokens(cwd, "t_x")).toBe("");
  });
});
