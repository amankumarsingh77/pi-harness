import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGraphifyService } from "../../src/services/graphify-service.js";
import type { GraphifyConfig } from "../../src/config.js";

const CONFIG: GraphifyConfig = {
  enabled: true,
  bootstrap: true,
  bootBlock: true,
  minVersion: "0.8.32",
  bin: "graphify",
  queryBudget: 2000,
};

describe("createGraphifyService", () => {
  it("installs Graphify and runs the initial graph build when graph.json is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-service-"));
    const calls: string[] = [];
    try {
      const service = createGraphifyService({
        cwd,
        config: CONFIG,
        run: async ({ command, args }) => {
          calls.push([command, ...args].join(" "));
          if (command === "graphify" && args[0] === "--version") {
            return { stdout: "graphify 0.8.22\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
      });

      await service.bootstrap();

      expect(calls).toEqual([
        "graphify --version",
        "uv tool install --upgrade graphifyy[mcp,svg,sql,terraform,office,pdf]",
        "graphify install --project --platform pi",
        "graphify extract . --out .",
        "graphify cluster-only .",
        "graphify --version",
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("skips install and initial build when the version and graph are already ready", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-service-ready-"));
    const calls: string[] = [];
    try {
      await mkdir(join(cwd, "graphify-out"), { recursive: true });
      await writeFile(join(cwd, "graphify-out", "graph.json"), "{}");
      const service = createGraphifyService({
        cwd,
        config: CONFIG,
        run: async ({ command, args }) => {
          calls.push([command, ...args].join(" "));
          return { stdout: "graphify 0.8.32\n", stderr: "" };
        },
      });

      await service.bootstrap();

      expect(calls).toEqual([
        "graphify --version",
        "graphify install --project --platform pi",
        "graphify --version",
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
