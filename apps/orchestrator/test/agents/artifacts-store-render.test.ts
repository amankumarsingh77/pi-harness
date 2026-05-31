import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), "art-render-"));
}

describe("ArtifactsStore mock renders", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = freshCwd();
  });

  it("writes and reads desktop and mobile PNGs for a mock page", async () => {
    const store = new ArtifactsStore({});
    await store.writeBrainstormMockRender(cwd, "t_1", "m_1", "home", {
      desktopPng: Buffer.from("DESK"),
      mobilePng: Buffer.from("MOB"),
    });
    const desk = await store.readBrainstormMockPng(cwd, "t_1", "m_1", "home", "desktop");
    const mob = await store.readBrainstormMockPng(cwd, "t_1", "m_1", "home", "mobile");
    expect(desk?.toString()).toBe("DESK");
    expect(mob?.toString()).toBe("MOB");
  });

  it("returns null for a missing render", async () => {
    const store = new ArtifactsStore({});
    expect(await store.readBrainstormMockPng(cwd, "t_1", "m_x", "home", "desktop")).toBeNull();
  });
});
