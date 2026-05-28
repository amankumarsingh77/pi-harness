import { describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GraphifyAutoInstaller,
  GraphifyInstallStore,
} from "../../src/agents/graphify-installer.js";

describe("GraphifyAutoInstaller", () => {
  it("installs the package, refreshes the Codex skill, and records ready on success", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "graphify-install-"));
    const calls: { command: string; args: readonly string[] }[] = [];
    const installer = new GraphifyAutoInstaller({
      stateDir,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, stdout: "installed", stderr: "" };
      },
    });

    await installer.installNow({ reason: "missing_cli", message: "missing" });

    expect(calls).toEqual([
      { command: "uv", args: ["tool", "install", "--force", "--upgrade", "graphifyy[mcp,ollama]"] },
      {
        command: "uv",
        args: ["tool", "run", "--from", "graphifyy[mcp,ollama]", "graphify", "install", "--platform", "codex"],
      },
    ]);
    expect(await installer.status()).toMatchObject({ status: "ready" });
    expect(await installer.hasReadyInstall()).toBe(true);
  });

  it("deduplicates concurrent install requests", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "graphify-install-"));
    const runCommand = vi.fn(async () => ({ ok: true as const, stdout: "ok", stderr: "" }));
    const installer = new GraphifyAutoInstaller({ stateDir, runCommand });

    const first = installer.installNow({ reason: "missing_cli", message: "missing" });
    const second = installer.installNow({ reason: "incompatible_cli", message: "bad binary" });
    await Promise.all([first, second]);

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(await installer.status()).toMatchObject({ status: "ready" });
  });

  it("upgrades the package before refreshing a stale skill", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "graphify-install-"));
    const calls: { command: string; args: readonly string[] }[] = [];
    const installer = new GraphifyAutoInstaller({
      stateDir,
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, stdout: "updated", stderr: "" };
      },
    });

    await installer.installNow({ reason: "stale_skill", message: "stale" });

    expect(calls).toEqual([
      { command: "uv", args: ["tool", "install", "--force", "--upgrade", "graphifyy[mcp,ollama]"] },
      {
        command: "uv",
        args: ["tool", "run", "--from", "graphifyy[mcp,ollama]", "graphify", "install", "--platform", "codex"],
      },
    ]);
    expect(await installer.status()).toMatchObject({ status: "ready" });
  });

  it("records failed installs with truncated output", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "graphify-install-"));
    const installer = new GraphifyAutoInstaller({
      stateDir,
      runCommand: async () => ({
        ok: false,
        stdout: "o".repeat(5000),
        stderr: "e".repeat(5000),
        message: "install failed",
      }),
    });

    await installer.installNow({ reason: "missing_cli", message: "missing" });

    const status = await installer.status();
    expect(status).toMatchObject({ status: "install_failed", reason: "missing_cli" });
    expect(status?.stdoutTail).toHaveLength(4000);
    expect(status?.stderrTail).toHaveLength(4000);
  });
});

describe("GraphifyInstallStore", () => {
  it("folds JSONL to the latest valid status and skips malformed lines", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "graphify-install-store-"));
    const store = new GraphifyInstallStore({ stateDir });

    await store.append({
      status: "installing",
      reason: "missing_cli",
      message: "missing",
      updatedAt: new Date("2026-05-21T00:00:00.000Z"),
    });
    await appendFile(join(stateDir, "store", "graphify-install.jsonl"), "{bad\n\n", "utf8");
    await store.append({
      status: "ready",
      updatedAt: new Date("2026-05-21T00:00:01.000Z"),
    });

    expect(await readFile(join(stateDir, "store", "graphify-install.jsonl"), "utf8")).toContain("{bad");
    expect(await store.latest()).toMatchObject({ status: "ready" });
  });
});
