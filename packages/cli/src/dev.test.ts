import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderComposeFile, renderHarnessConfig } from "./init.js";
import { runDev } from "./dev.js";
import { mergeHarnessProjectConfig } from "@pi-harness/shared";
import { loadProjectConfig } from "./config.js";

describe("runDev", () => {
  it("supports check-only mode without starting services", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-harness-dev-"));
    const config = mergeHarnessProjectConfig({ repoRoot: dir, baseBranch: "main" });
    try {
      await mkdir(join(dir, ".git"));
      await mkdir(join(dir, ".harness", "runtime"), { recursive: true });
      await writeFile(join(dir, "harness.config.ts"), renderHarnessConfig(config));
      await writeFile(join(dir, ".harness", "runtime", "compose.yml"), renderComposeFile(config));
      await writeFile(join(dir, ".env.harness.example"), "CROFAI_API_KEY=\n");

      const commands: string[] = [];
      const result = await runDev({
        cwd: dir,
        env: {},
        checkOnly: true,
        execFile: async (cmd, args) => {
          commands.push(`${cmd} ${args.join(" ")}`);
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          if (cmd === "podman" && args[0] === "--version") {
            return { ok: true, stdout: "podman version 5\n", stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "unexpected" };
        },
      });

      expect(result).toEqual({
        ok: true,
        mode: "check-only",
        dashboardUrl: "http://localhost:3000",
      });
      expect(commands).not.toContain("podman compose");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadProjectConfig", () => {
  it("loads generated configs without requiring project-local imports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-harness-config-"));
    const config = mergeHarnessProjectConfig({ repoRoot: dir, baseBranch: "trunk" });
    try {
      await mkdir(join(dir, ".git"));
      await writeFile(join(dir, "harness.config.ts"), renderHarnessConfig(config));

      const result = await loadProjectConfig({
        cwd: dir,
        env: {},
        execFile: async (cmd, args) => {
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "unexpected" };
        },
      });

      expect(result).toMatchObject({
        ok: true,
        config: {
          repoRoot: dir,
          baseBranch: "trunk",
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps compatibility with defineHarnessConfig configs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-harness-config-"));
    try {
      await mkdir(join(dir, ".git"));
      await writeFile(
        join(dir, "harness.config.ts"),
        `import { defineHarnessConfig } from "@pi-harness/shared";

export default defineHarnessConfig({
  repoRoot: ${JSON.stringify(dir)},
  baseBranch: "main",
});
`,
      );

      const result = await loadProjectConfig({
        cwd: dir,
        env: {},
        execFile: async (cmd, args) => {
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "unexpected" };
        },
      });

      expect(result).toMatchObject({
        ok: true,
        config: {
          repoRoot: dir,
          baseBranch: "main",
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects stale Graphify config blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-harness-config-"));
    try {
      await mkdir(join(dir, ".git"));
      await writeFile(
        join(dir, "harness.config.ts"),
        `export default {
  repoRoot: ${JSON.stringify(dir)},
  baseBranch: "main",
  graphify: {
    provider: "custom",
    model: "model-x",
    baseUrl: "https://models.example/v1",
    apiKeyEnv: "CUSTOM_API_KEY",
  },
};
`,
      );

      const result = await loadProjectConfig({
        cwd: dir,
        env: {},
        execFile: async (cmd, args) => {
          if (cmd === "git" && args.join(" ") === "rev-parse --show-toplevel") {
            return { ok: true, stdout: `${dir}\n`, stderr: "" };
          }
          return { ok: false, stdout: "", stderr: "unexpected" };
        },
      });

      expect(result).toMatchObject({ ok: false, error: "invalid_config" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
