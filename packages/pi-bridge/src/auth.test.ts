import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthError, __resetAuthCache, getApiKey } from "./auth.js";

let dir: string;
let prevCwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "auth-"));
  prevCwd = process.cwd();
  process.chdir(dir);
  __resetAuthCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(dir, { recursive: true, force: true });
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
});
