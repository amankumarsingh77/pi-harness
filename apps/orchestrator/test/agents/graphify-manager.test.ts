import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphifyManager, GRAPHIFY_INSTALL_HINT } from "../../src/agents/graphify-manager.js";

describe("GraphifyManager", () => {
  it("initializes the graph when graph.json is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const calls: string[][] = [];
    const manager = new GraphifyManager({
      runCommand: async (_cmd, args) => {
        calls.push([...args]);
        await writeGraph(cwd);
        return { ok: true, stdout: "indexed", stderr: "" };
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([[".", "--wiki", "--no-viz"]]);
    expect(result.ok && result.status.nodeCount).toBe(1);
  });

  it("skips initialization when a valid graph already exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    await writeGraph(cwd);
    const manager = new GraphifyManager({
      runCommand: async () => {
        throw new Error("should not run");
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(true);
    expect(result.ok && result.skipped).toBe(true);
  });

  it("updates an existing graph with graphify update", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    await writeGraph(cwd);
    const calls: string[][] = [];
    const manager = new GraphifyManager({
      runCommand: async (_cmd, args) => {
        calls.push([...args]);
        await writeGraph(cwd, "updated");
        return { ok: true, stdout: "updated", stderr: "" };
      },
    });

    const result = await manager.update(cwd, "code_commit");

    expect(result.ok).toBe(true);
    expect(calls).toEqual([["update", "."]]);
    expect(result.ok && result.status.nodeCount).toBe(1);
  });

  it("returns setup guidance when the Graphify CLI is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const manager = new GraphifyManager({
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr: "",
        message: "spawn graphify ENOENT",
        missingExecutable: true,
      }),
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("missing_cli");
    expect(result.ok ? "" : result.message).toContain(GRAPHIFY_INSTALL_HINT);
  });

  it("reports invalid graph output after a successful command", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const manager = new GraphifyManager({
      runCommand: async () => {
        await mkdir(join(cwd, "graphify-out"), { recursive: true });
        await writeFile(join(cwd, "graphify-out", "graph.json"), "{\"edges\":[]}", "utf8");
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("invalid_graph");
  });
});

async function writeGraph(cwd: string, label = "root"): Promise<void> {
  await mkdir(join(cwd, "graphify-out"), { recursive: true });
  await writeFile(
    join(cwd, "graphify-out", "graph.json"),
    JSON.stringify({
      nodes: [{ id: "n1", label, kind: "file", source: "README.md" }],
      edges: [],
    }),
    "utf8",
  );
}
