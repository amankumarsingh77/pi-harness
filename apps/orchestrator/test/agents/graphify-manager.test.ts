import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GraphifyManager,
  GRAPHIFY_INSTALL_HINT,
  GRAPHIFY_COMMAND_TIMEOUT_MS,
  runExecFile,
} from "../../src/agents/graphify-manager.js";
import type { GraphifyInstallCoordinator } from "../../src/agents/graphify-installer.js";

describe("GraphifyManager", () => {
  it("initializes the graph when graph.json is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const stateDir = join(cwd, ".state");
    const calls: { command: string; args: readonly string[]; env?: Readonly<Record<string, string | undefined>> }[] = [];
    const manager = new GraphifyManager({
      stateDir,
      env: { CROFAI_API_KEY: "crofai-key" },
      runCommand: async (command, args, opts) => {
        calls.push({ command, args, env: opts.env });
        await writeGraph(cwd);
        return { ok: true, stdout: "indexed", stderr: "" };
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "graphify",
        args: [
          "extract",
          ".",
          "--backend",
          "ollama",
          "--model",
          "deepseek-v4-pro",
          "--out",
          ".",
        ],
        env: expect.objectContaining({
          OLLAMA_API_KEY: "crofai-key",
          OLLAMA_BASE_URL: "https://crof.ai/v1",
          OLLAMA_MODEL: "deepseek-v4-pro",
        }),
      },
    ]);
    expect(result.ok && result.status.nodeCount).toBe(1);
    expect(result.ok && result.status.graphPath).toContain(join(".state", "graphify"));
    expect(await readFile(result.ok ? result.status.graphPath : "", "utf8")).toContain("root");
  });

  it("skips initialization when a valid graph already exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const stateDir = join(cwd, ".state");
    const manager = new GraphifyManager({
      stateDir,
      runCommand: async () => {
        throw new Error("should not run");
      },
    });
    await writeGraph(cwd);
    await manager.ensureInitialized(cwd);
    const manager2 = new GraphifyManager({
      stateDir,
      runCommand: async () => {
        throw new Error("should not run");
      },
    });

    const result = await manager2.ensureInitialized(cwd);

    expect(result.ok).toBe(true);
    expect(result.ok && result.skipped).toBe(true);
  });

  it("falls back to legacy graphify-out graph when durable graph is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    await writeGraph(cwd);
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      runCommand: async () => {
        throw new Error("should not run");
      },
    });

    const status = await manager.status(cwd);

    expect(status.valid).toBe(true);
    expect(status.graphPath).toBe(join(cwd, "graphify-out", "graph.json"));
  });

  it("updates an existing graph with graphify update", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const stateDir = join(cwd, ".state");
    await writeGraph(cwd);
    const calls: string[][] = [];
    const manager = new GraphifyManager({
      stateDir,
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
    expect(await readFile(result.ok ? result.status.graphPath : "", "utf8")).toContain("updated");
  });

  it("returns setup guidance when the Graphify CLI is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const installs: Parameters<GraphifyInstallCoordinator["triggerInstall"]>[0][] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      env: { CROFAI_API_KEY: "crofai-key" },
      installer: {
        async hasReadyInstall() {
          return false;
        },
        triggerInstall(input) {
          installs.push(input);
        },
      },
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
    expect(installs).toEqual([
      expect.objectContaining({ reason: "missing_cli" }),
    ]);
  });

  it("auto-triggers install for an incompatible graphify binary", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const installs: Parameters<GraphifyInstallCoordinator["triggerInstall"]>[0][] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      env: { CROFAI_API_KEY: "crofai-key" },
      installer: {
        async hasReadyInstall() {
          return false;
        },
        triggerInstall(input) {
          installs.push(input);
        },
      },
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr: "error: unknown command '.'\nRun 'graphify --help' for usage.",
        message: "error: unknown command '.'\nRun 'graphify --help' for usage.",
        missingExecutable: false,
      }),
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("incompatible_cli");
    expect(installs).toEqual([
      expect.objectContaining({ reason: "incompatible_cli" }),
    ]);
  });

  it("auto-triggers install when the Graphify skill is stale", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const installs: Parameters<GraphifyInstallCoordinator["triggerInstall"]>[0][] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      env: { CROFAI_API_KEY: "crofai-key" },
      installer: {
        async hasReadyInstall() {
          return true;
        },
        triggerInstall(input) {
          installs.push(input);
        },
      },
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr:
          "warning: skill is from graphify 0.5.0, package is 0.8.19. Run 'graphify install' to update.\nerror: no LLM API key found.",
        message:
          "warning: skill is from graphify 0.5.0, package is 0.8.19. Run 'graphify install' to update.\nerror: no LLM API key found.",
        missingExecutable: false,
      }),
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("stale_skill");
    expect(installs).toEqual([
      expect.objectContaining({ reason: "stale_skill" }),
    ]);
  });

  it("auto-triggers install when the Graphify ollama extra is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const installs: Parameters<GraphifyInstallCoordinator["triggerInstall"]>[0][] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      env: { CROFAI_API_KEY: "crofai-key" },
      installer: {
        async hasReadyInstall() {
          return true;
        },
        triggerInstall(input) {
          installs.push(input);
        },
      },
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr:
          "[graphify] chunk 1/12 failed: Gemini/Kimi/Ollama/OpenAI-compatible extraction requires the openai package. Run: pip install openai",
        message:
          "[graphify extract] error: all semantic chunks failed for backend 'ollama' - see per-chunk errors above. If you see 'requires the X package', run `pip install X` and retry.",
        missingExecutable: false,
      }),
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("missing_python_extra");
    expect(installs).toEqual([
      expect.objectContaining({ reason: "missing_python_extra" }),
    ]);
  });

  it("reports missing LLM backend keys without retrying package install", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const installs: Parameters<GraphifyInstallCoordinator["triggerInstall"]>[0][] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      installer: {
        async hasReadyInstall() {
          return true;
        },
        triggerInstall(input) {
          installs.push(input);
        },
      },
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr:
          "error: no LLM API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY (gemini), ANTHROPIC_API_KEY (claude), OPENAI_API_KEY (openai), or pass --backend.",
        message:
          "error: no LLM API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY (gemini), ANTHROPIC_API_KEY (claude), OPENAI_API_KEY (openai), or pass --backend.",
        missingExecutable: false,
      }),
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("missing_llm_key");
    expect(result.ok ? "" : result.message).toContain("CROFAI_API_KEY");
    expect(installs).toEqual([]);
  });

  it("uses uv tool run after Graphify has been installed by the orchestrator", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const stateDir = join(cwd, ".state");
    const calls: { command: string; args: readonly string[]; env?: Readonly<Record<string, string | undefined>> }[] = [];
    const manager = new GraphifyManager({
      stateDir,
      env: { CROFAI_API_KEY: "crofai-key" },
      installer: {
        async hasReadyInstall() {
          return true;
        },
        triggerInstall() {},
      },
      runCommand: async (command, args, opts) => {
        calls.push({ command, args, env: opts.env });
        await writeGraph(cwd);
        return { ok: true, stdout: "indexed", stderr: "" };
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        command: "uv",
        args: [
          "tool",
          "run",
          "--from",
          "graphifyy[mcp,ollama]",
          "graphify",
          "extract",
          ".",
          "--backend",
          "ollama",
          "--model",
          "deepseek-v4-pro",
          "--out",
          ".",
        ],
        env: expect.objectContaining({
          OLLAMA_API_KEY: "crofai-key",
          OLLAMA_BASE_URL: "https://crof.ai/v1",
          OLLAMA_MODEL: "deepseek-v4-pro",
        }),
      },
    ]);
  });

  it("uses Graphify provider overrides for semantic extraction", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const calls: { args: readonly string[]; env?: Readonly<Record<string, string | undefined>> }[] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      graphify: {
        provider: "custom",
        model: "model-x",
        baseUrl: "https://models.example/v1",
        apiKeyEnv: "CUSTOM_API_KEY",
      },
      env: { CUSTOM_API_KEY: "custom-key" },
      installer: {
        async hasReadyInstall() {
          return true;
        },
        triggerInstall() {},
      },
      runCommand: async (_command, args, opts) => {
        calls.push({ args, env: opts.env });
        await writeGraph(cwd);
        return { ok: true, stdout: "indexed", stderr: "" };
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        args: [
          "tool",
          "run",
          "--from",
          "graphifyy[mcp,ollama]",
          "graphify",
          "extract",
          ".",
          "--backend",
          "ollama",
          "--model",
          "model-x",
          "--out",
          ".",
        ],
        env: expect.objectContaining({
          OLLAMA_API_KEY: "custom-key",
          OLLAMA_BASE_URL: "https://models.example/v1",
          OLLAMA_MODEL: "model-x",
        }),
      },
    ]);
  });

  it("reports missing Graphify provider credentials without triggering install or extraction", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const installs: Parameters<GraphifyInstallCoordinator["triggerInstall"]>[0][] = [];
    const calls: string[][] = [];
    const configMessages: string[] = [];
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      env: {},
      installer: {
        async hasReadyInstall() {
          return false;
        },
        triggerInstall(input) {
          installs.push(input);
        },
        recordConfigRequired(input) {
          configMessages.push(input.message);
        },
      },
      runCommand: async (_command, args) => {
        calls.push([...args]);
        return { ok: true, stdout: "", stderr: "" };
      },
    });

    const result = await manager.ensureInitialized(cwd);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("missing_llm_key");
    expect(result.ok ? "" : result.message).toContain("CROFAI_API_KEY");
    expect(calls).toEqual([]);
    expect(installs).toEqual([]);
    expect(configMessages).toEqual([
      "Graphify provider 'crofai' requires CROFAI_API_KEY for semantic extraction.",
    ]);
  });

  it("reports invalid graph output after a successful command", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "graphify-manager-"));
    const manager = new GraphifyManager({
      stateDir: join(cwd, ".state"),
      env: { CROFAI_API_KEY: "crofai-key" },
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

describe("runExecFile", () => {
  it("kills a hung command and returns a failure instead of blocking forever", async () => {
    // Regression: a graphify subprocess that never exits (e.g. waiting on an
    // unreachable LLM backend) used to hang the brainstorm tick indefinitely,
    // wedging the task in `brainstorming` with no run. The runner must enforce
    // a timeout so the hang surfaces as a failure the run-loop can swallow.
    // Production default is generous (graphify extraction is legitimately
    // slow); the test overrides it with a tiny value to stay fast.
    expect(GRAPHIFY_COMMAND_TIMEOUT_MS).toBeGreaterThan(0);

    const cwd = await mkdtemp(join(tmpdir(), "graphify-timeout-"));
    const started = Date.now();
    // `sleep 30` blocks far longer than the 200ms timeout; runner must abort.
    const result = await runExecFile("sleep", ["30"], { cwd, timeoutMs: 200 });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    // It returned because of the timeout, not because sleep finished.
    expect(elapsed).toBeLessThan(5_000);
    expect(result.ok === false && result.missingExecutable).toBe(false);
  }, 30_000);
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
