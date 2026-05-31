import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignSystemStore } from "../../src/agents/design-system-store.js";

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), "ds-write-"));
}

describe("DesignSystemStore.writePromotion", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = freshCwd();
  });

  it("bootstraps version 1 on first promotion and writes all files", async () => {
    const store = new DesignSystemStore({});
    const res = await store.writePromotion(cwd, {
      tokensCss: ":root { --accent: #2563eb; }",
      designMdDelta: "Accent set.",
      summary: "first promote",
      task: "t_1",
      exemplar: { title: "Home", pngBytes: Buffer.from("PNG"), promotedMockId: "m_1" },
    });
    expect(res.tokenVersion).toBe(1);
    const ds = await store.read(cwd);
    expect(ds.manifest.tokenVersion).toBe(1);
    expect(ds.tokensCss).toContain("--accent: #2563eb");
    expect(ds.manifest.exemplars).toHaveLength(1);
    expect(existsSync(join(store.galleryDir(cwd), `${ds.manifest.exemplars[0].id}.png`))).toBe(true);
  });

  it("bumps the version and serializes concurrent promotions without losing either", async () => {
    const store = new DesignSystemStore({});
    const [a, b] = await Promise.all([
      store.writePromotion(cwd, {
        tokensCss: ":root { --accent: #111; }",
        designMdDelta: "a",
        summary: "a",
        task: "t_a",
        exemplar: { title: "A", pngBytes: Buffer.from("A"), promotedMockId: "m_a" },
      }),
      store.writePromotion(cwd, {
        tokensCss: ":root { --accent: #222; }",
        designMdDelta: "b",
        summary: "b",
        task: "t_b",
        exemplar: { title: "B", pngBytes: Buffer.from("B"), promotedMockId: "m_b" },
      }),
    ]);
    const versions = [a.tokenVersion, b.tokenVersion].sort();
    expect(versions).toEqual([1, 2]);
    const ds = await store.read(cwd);
    expect(ds.manifest.tokenVersion).toBe(2);
    expect(ds.manifest.exemplars).toHaveLength(2);
    expect(ds.manifest.history).toHaveLength(2);
  });
});
