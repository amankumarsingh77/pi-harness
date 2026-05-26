import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  makeGraphifyQueryTools,
  makeGraphifyRefreshTool,
} from "../../src/agents/graphify-tools.js";
import { graphDirFor } from "../../src/agents/graphify-manager.js";
import type { GraphifyLifecycle, GraphifyRunResult, GraphifyStatus } from "../../src/agents/graphify-manager.js";

describe("Graphify tools", () => {
  it("reports missing graph instead of throwing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-tools-"));
    const query = makeGraphifyQueryTools({ cwd }).find((tool) => tool.name === "graphify_query");
    if (!query) throw new Error("missing graphify_query");

    const result = await query.execute("t1", { query: "runner" }, undefined, undefined, undefined as never);

    expect(result.details.ok).toBe(false);
    expect(result.content[0]!.text).toContain("graphify-out/graph.json does not exist");
  });

  it("queries graph nodes and returns concise matches", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-tools-"));
    const stateDir = join(cwd, ".state");
    await writeGraph(graphDirFor(cwd, stateDir), ".");
    const query = makeGraphifyQueryTools({ cwd, stateDir }).find((tool) => tool.name === "graphify_query");
    if (!query) throw new Error("missing graphify_query");

    const result = await query.execute("t1", { query: "runLoop" }, undefined, undefined, undefined as never);

    expect(result.details.ok).toBe(true);
    expect(result.content[0]!.text).toContain("runLoop");
  });

  it("finds a path between graph nodes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-tools-"));
    await writeGraph(cwd);
    const path = makeGraphifyQueryTools({ cwd }).find((tool) => tool.name === "graphify_path");
    if (!path) throw new Error("missing graphify_path");

    const result = await path.execute(
      "t1",
      { source: "runLoop", target: "GraphifyManager" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details.ok).toBe(true);
    expect(result.content[0]!.text).toContain("runLoop");
    expect(result.content[0]!.text).toContain("GraphifyManager");
  });

  it("falls back to legacy graphify-out graph", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-tools-"));
    await writeGraph(cwd, "graphify-out");
    const query = makeGraphifyQueryTools({ cwd, stateDir: join(cwd, ".state") }).find((tool) => tool.name === "graphify_query");
    if (!query) throw new Error("missing graphify_query");

    const result = await query.execute("t1", { query: "runLoop" }, undefined, undefined, undefined as never);

    expect(result.details.ok).toBe(true);
    expect(result.content[0]!.text).toContain("runLoop");
  });

  it("refreshes through the injected manager", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-tools-"));
    const calls: string[] = [];
    const graphify: GraphifyLifecycle = {
      async ensureInitialized() {
        throw new Error("unused");
      },
      async status() {
        return status(cwd);
      },
      async update(updateCwd) {
        calls.push(updateCwd);
        return {
          ok: true,
          action: "update",
          cwd: updateCwd,
          status: status(updateCwd),
          stdout: "",
          stderr: "",
          skipped: false,
        } satisfies GraphifyRunResult;
      },
    };

    const refresh = makeGraphifyRefreshTool({ cwd, graphify });
    const result = await refresh.execute("t1", {}, undefined, undefined, undefined as never);

    expect(result.details.ok).toBe(true);
    expect(calls).toEqual([cwd]);
  });
});

async function writeGraph(cwd: string, relDir = "graphify-out"): Promise<void> {
  await mkdir(join(cwd, relDir), { recursive: true });
  await writeFile(
    join(cwd, relDir, "graph.json"),
    JSON.stringify({
      nodes: [
        { id: "n1", label: "runLoop", kind: "function", source: "apps/orchestrator/src/runner/run-loop.ts" },
        { id: "n2", label: "GraphifyManager", kind: "class", source: "apps/orchestrator/src/agents/graphify-manager.ts" },
      ],
      edges: [{ source: "n1", target: "n2", label: "uses" }],
    }),
    "utf8",
  );
}


function status(cwd: string): GraphifyStatus {
  return {
    graphPath: join(cwd, "graphify-out", "graph.json"),
    exists: true,
    valid: true,
    nodeCount: 2,
    edgeCount: 1,
  };
}
