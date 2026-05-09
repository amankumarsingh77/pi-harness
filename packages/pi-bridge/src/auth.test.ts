import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthError, __resetAuthCache, getApiKey } from "./auth.js";

// Keys whose presence/absence we manipulate in this suite. Each test starts
// with all of them cleared from process.env so dotenv doesn't fall through
// to a leaked value from a prior test.
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

describe("getApiKey provider env var resolution", () => {
  it("opencode-go resolves to OPENCODE_API_KEY (matches pi's provider table)", () => {
    writeFileSync(join(dir, ".env.harness"), "OPENCODE_API_KEY=zen-key\n");
    expect(getApiKey("opencode-go")).toBe("zen-key");
  });

  it("opencode resolves to OPENCODE_API_KEY (same key as opencode-go)", () => {
    writeFileSync(join(dir, ".env.harness"), "OPENCODE_API_KEY=zen-key\n");
    expect(getApiKey("opencode")).toBe("zen-key");
  });

  it("anthropic resolves to ANTHROPIC_API_KEY", () => {
    writeFileSync(join(dir, ".env.harness"), "ANTHROPIC_API_KEY=ant-key\n");
    expect(getApiKey("anthropic")).toBe("ant-key");
  });

  it("missing key raises AuthError naming the env var pi expects", () => {
    writeFileSync(join(dir, ".env.harness"), "");
    expect(() => getApiKey("opencode-go")).toThrowError(AuthError);
    expect(() => getApiKey("opencode-go")).toThrowError(/OPENCODE_API_KEY/);
  });

  it("finds .env.harness at the monorepo root, not the per-package cwd", () => {
    // Simulate the orchestrator launch where pnpm sets cwd to apps/orchestrator.
    // The .env.harness lives at the workspace root, marked by pnpm-workspace.yaml.
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    writeFileSync(join(dir, ".env.harness"), "OPENCODE_API_KEY=root-key\n");
    const sub = join(dir, "apps", "orchestrator");
    mkdirSync(sub, { recursive: true });
    process.chdir(sub);
    __resetAuthCache();
    expect(getApiKey("opencode-go")).toBe("root-key");
  });
});
