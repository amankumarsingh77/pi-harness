import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as dotenvConfig, parse as dotenvParse } from "dotenv";

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
// at the monorepo root and primes those env vars. Already-set non-empty shell
// vars win; empty shell vars are treated as unset so the harness file can
// repair a common `CROFAI_API_KEY=` environment leak.
export function loadEnvHarness(): void {
  if (loaded) return;
  loaded = true;
  const path = join(findMonorepoRoot(process.cwd()), ".env.harness");
  const result = dotenvConfig({ path });
  if (!existsSync(path)) return;

  const parsed = result.parsed ?? dotenvParse(readFileSync(path));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === "" && value !== "") {
      process.env[key] = value;
    }
  }
}

// Test-only: rearm the load() guard so tests that rewrite .env.harness can
// re-trigger discovery. Tests must clear the affected `process.env` entries
// themselves; dotenv only writes new keys, never overwrites.
export function __resetAuthCache(): void {
  loaded = false;
}
