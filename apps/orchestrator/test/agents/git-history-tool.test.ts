import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { makeGitHistoryTool } from "../../src/agents/git-history-tool.js";

let scratch: string;
let cwd: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "git-history-tool-"));
  cwd = join(scratch, "repo");
  await mkdir(cwd, { recursive: true });
  const git = simpleGit(cwd);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(cwd, "alpha.ts"), "export const alpha = 1;\n");
  await git.add("alpha.ts");
  await git.commit("feat: add alpha");
  await writeFile(join(cwd, "alpha.ts"), "export const alpha = 2;\n");
  await writeFile(join(cwd, "beta.ts"), "export const beta = 1;\n");
  await git.add(["alpha.ts", "beta.ts"]);
  await git.commit("fix: update alpha and add beta");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function runGitHistory(params: Record<string, unknown>) {
  const tool = makeGitHistoryTool({ cwd });
  return tool.execute("git-history", params, undefined, undefined, undefined as never);
}

describe("git_history tool", () => {
  it("reports whether cwd is a git repository", async () => {
    const result = await runGitHistory({ action: "is_repo" });
    expect(result.details.ok).toBe(true);
    expect(result.details.output.trim()).toBe("true");
  });

  it("logs commits by path", async () => {
    const result = await runGitHistory({
      action: "log_by_path",
      path: "alpha.ts",
      limit: 5,
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.output).toContain("fix: update alpha");
    expect(result.details.output).toContain("feat: add alpha");
  });

  it("logs commits by message grep", async () => {
    const result = await runGitHistory({
      action: "log_by_grep",
      query: "update alpha",
      limit: 5,
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.output).toContain("fix: update alpha");
    expect(result.details.output).not.toContain("feat: add alpha");
  });

  it("shows commit stats", async () => {
    const log = await runGitHistory({
      action: "log_by_grep",
      query: "update alpha",
    });
    const commit = log.details.output.split(" ")[0]!;

    const result = await runGitHistory({ action: "show_stat", commit });

    expect(result.details.ok).toBe(true);
    expect(result.details.output).toContain("alpha.ts");
    expect(result.details.output).toContain("beta.ts");
  });

  it("shows a file at a commit", async () => {
    const log = await runGitHistory({
      action: "log_by_grep",
      query: "add alpha",
    });
    const commit = log.details.output.split(" ")[0]!;

    const result = await runGitHistory({
      action: "show_file_at_commit",
      commit,
      path: "alpha.ts",
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.output).toBe("export const alpha = 1;\n");
  });

  it("rejects missing required params", async () => {
    const result = await runGitHistory({ action: "show_file_at_commit", path: "alpha.ts" });

    expect(result.details.ok).toBe(false);
    expect(result.details.error).toContain("commit");
  });

  it("enforces an optional call budget", async () => {
    const tool = makeGitHistoryTool({ cwd, maxCalls: 1 });
    const first = await tool.execute(
      "git-history",
      { action: "is_repo" },
      undefined,
      undefined,
      undefined as never,
    );
    const second = await tool.execute(
      "git-history",
      { action: "is_repo" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(first.details.ok).toBe(true);
    expect(second.details.ok).toBe(false);
    expect(second.details.error).toContain("call budget exceeded");
  });
});
