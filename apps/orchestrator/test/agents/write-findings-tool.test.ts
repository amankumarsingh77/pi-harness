import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeWriteFindingsTool } from "../../src/agents/write-findings-tool.js";

describe("write-findings-tool", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "wf-tool-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("writes to the path bound at construction", async () => {
    const tool = makeWriteFindingsTool({ cwd, taskId: "T-1", subagent: "codebase-locator" });
    const expected = join(cwd, ".harness", "T-1", "research", "codebase-locator.md");

    const res = await tool.execute("call-1", { body: "## Files\n- foo.ts\n" }, undefined, undefined, undefined as never);

    expect(res.details).toEqual({ ok: true, path: expected });
    expect(existsSync(expected)).toBe(true);
    expect(await readFile(expected, "utf8")).toBe("## Files\n- foo.ts\n");
  });

  it("creates the parent research directory if missing", async () => {
    const tool = makeWriteFindingsTool({ cwd, taskId: "T-2", subagent: "precedent-locator" });
    expect(existsSync(join(cwd, ".harness", "T-2", "research"))).toBe(false);

    await tool.execute("c", { body: "x" }, undefined, undefined, undefined as never);

    const dirInfo = await stat(join(cwd, ".harness", "T-2", "research"));
    expect(dirInfo.isDirectory()).toBe(true);
  });

  it("overwrites cleanly on a second call", async () => {
    const tool = makeWriteFindingsTool({ cwd, taskId: "T-3", subagent: "integration-scanner" });

    await tool.execute("c1", { body: "first" }, undefined, undefined, undefined as never);
    await tool.execute("c2", { body: "second" }, undefined, undefined, undefined as never);

    const path = join(cwd, ".harness", "T-3", "research", "integration-scanner.md");
    expect(await readFile(path, "utf8")).toBe("second");
  });

  it("preserves UTF-8 content", async () => {
    const tool = makeWriteFindingsTool({ cwd, taskId: "T-4", subagent: "codebase-scout" });
    const body = "## Files\n- 日本語/ファイル.ts\n- emoji 🚀\n";

    await tool.execute("c", { body }, undefined, undefined, undefined as never);

    const path = join(cwd, ".harness", "T-4", "research", "codebase-scout.md");
    expect(await readFile(path, "utf8")).toBe(body);
  });
});
