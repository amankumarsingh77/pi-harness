import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DesignSystemStore } from "../../src/agents/design-system-store.js";

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ds-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "root"], { cwd: dir });
  return dir;
}

describe("DesignSystemStore.commitToMain", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = gitRepo();
  });

  it("commits the design dir to main with the given message", async () => {
    const store = new DesignSystemStore({});
    await store.writePromotion(cwd, {
      tokensCss: ":root{--accent:#000;}",
      designMdDelta: "x",
      summary: "s",
      task: "t_1",
      exemplar: { title: "T", pngBytes: Buffer.from("P"), promotedMockId: "m_1" },
    });
    await store.commitToMain(cwd, "design(system): promote T (v1)");
    const log = execFileSync("git", ["log", "--oneline", "-1"], { cwd, encoding: "utf8" });
    expect(log).toContain("promote T (v1)");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
    expect(status.trim()).toBe("");
  });
});
