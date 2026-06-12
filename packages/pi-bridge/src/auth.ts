import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as dotenvParse } from "dotenv";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const harnessEnvValues = new Map<string, string>();

function findMonorepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

// Loads `.env.harness` into process.env. The SDK reads provider credentials
// straight from `process.env`; this shim locates the file the user keeps at the
// monorepo root and primes those env vars. Already-set non-empty shell vars win.
// Values previously loaded from `.env.harness` are refreshed on every call so
// the dashboard's Refresh button can pick up credential edits without restart.
export function loadEnvHarness(): void {
  const path = join(findMonorepoRoot(process.cwd()), ".env.harness");
  if (!existsSync(path)) return;

  const parsed = dotenvParse(readFileSync(path));
  for (const [key, previousValue] of harnessEnvValues) {
    if (key in parsed) continue;
    if (process.env[key] === previousValue) {
      delete process.env[key];
    }
    harnessEnvValues.delete(key);
  }

  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key];
    const previousValue = harnessEnvValues.get(key);
    if (current === undefined || current === "" || current === previousValue) {
      process.env[key] = value;
      harnessEnvValues.set(key, value);
    }
  }
}

// Test-only: clear file-sourced env tracking. Tests must clear affected
// `process.env` entries themselves.
export function __resetAuthCache(): void {
  harnessEnvValues.clear();
}
