import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as dotenvConfig } from "dotenv";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

let loaded = false;

function findMonorepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

// Loads `.env.harness` once per process. The SDK reads provider credentials
// straight from `process.env`; this shim only locates the file the user keeps
// at the monorepo root and primes those env vars. Already-set shell vars win
// (dotenv default `override:false`).
export function loadEnvHarness(): void {
  if (loaded) return;
  loaded = true;
  dotenvConfig({ path: join(findMonorepoRoot(process.cwd()), ".env.harness") });
}

// Test-only: rearm the load() guard so tests that rewrite .env.harness can
// re-trigger discovery. Tests must clear the affected `process.env` entries
// themselves; dotenv only writes new keys, never overwrites.
export function __resetAuthCache(): void {
  loaded = false;
}
