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

// Map provider -> env var name. Mirrors pi's expected env layout.
const PROVIDER_KEY_VAR: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  "google-vertex": "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  // OpenCode Zen and OpenCode Go share OPENCODE_API_KEY per pi's provider
  // table; the dash-to-underscore fallback would otherwise mint
  // OPENCODE_GO_API_KEY which pi doesn't recognise.
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
};

function envVarFor(provider: string): string {
  return PROVIDER_KEY_VAR[provider] ?? `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

// Walk up from `start` looking for the monorepo root (marked by
// pnpm-workspace.yaml). Returns the root dir, or `start` itself if no marker
// is found — a non-monorepo caller still gets a deterministic location.
function findMonorepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function load(): void {
  if (loaded) return;
  const root = findMonorepoRoot(process.cwd());
  // override:false (the default) so any key already set in the shell wins
  // over the file value. Missing file is silently ignored — getApiKey will
  // raise AuthError if the resolved env var is empty.
  dotenvConfig({ path: join(root, ".env.harness") });
  loaded = true;
}

export function getApiKey(provider: string): string {
  load();
  const name = envVarFor(provider);
  const v = process.env[name];
  if (!v) throw new AuthError(`missing API key for ${provider} (expected ${name} in .env.harness)`);
  return v;
}

// Test-only: drop the cache so tests can reload .env.harness between cases.
// Note: dotenv writes to process.env, so __resetAuthCache only re-arms the
// load() guard. Tests that change .env.harness contents must also clear the
// affected process.env entries themselves.
export function __resetAuthCache(): void {
  loaded = false;
}
