import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetAuthCache, loadEnvHarness } from "./auth.js";

const TOUCHED_KEYS = ["OPENCODE_API_KEY", "ANTHROPIC_API_KEY"];

let dir: string;
let prevCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "auth-"));
  prevCwd = process.cwd();
  process.chdir(dir);
  for (const k of TOUCHED_KEYS) delete process.env[k];
  __resetAuthCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
  for (const k of TOUCHED_KEYS) delete process.env[k];
  __resetAuthCache();
});

describe("loadEnvHarness", () => {
  it("primes process.env from .env.harness in the current directory", () => {
    writeFileSync(join(dir, ".env.harness"), "ANTHROPIC_API_KEY=ant-key\n");
    loadEnvHarness();
    expect(process.env["ANTHROPIC_API_KEY"]).toBe("ant-key");
  });

  it("walks up to the monorepo root (marked by pnpm-workspace.yaml)", () => {
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    writeFileSync(join(dir, ".env.harness"), "OPENCODE_API_KEY=root-key\n");
    const sub = join(dir, "apps", "orchestrator");
    mkdirSync(sub, { recursive: true });
    process.chdir(sub);
    __resetAuthCache();
    loadEnvHarness();
    expect(process.env["OPENCODE_API_KEY"]).toBe("root-key");
  });

  it("does not overwrite an env var already set in the shell", () => {
    process.env["ANTHROPIC_API_KEY"] = "shell-key";
    writeFileSync(join(dir, ".env.harness"), "ANTHROPIC_API_KEY=file-key\n");
    loadEnvHarness();
    expect(process.env["ANTHROPIC_API_KEY"]).toBe("shell-key");
  });

  it("is idempotent within a single process (cache guard)", () => {
    writeFileSync(join(dir, ".env.harness"), "ANTHROPIC_API_KEY=first\n");
    loadEnvHarness();
    delete process.env["ANTHROPIC_API_KEY"];
    writeFileSync(join(dir, ".env.harness"), "ANTHROPIC_API_KEY=second\n");
    loadEnvHarness();
    expect(process.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });
});
