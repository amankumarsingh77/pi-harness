import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

let cache: Record<string, string> | null = null;

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
  // OpenCode Zen (`opencode`) and OpenCode Go (`opencode-go`) share a single
  // env var per pi's provider table — the dash-to-underscore fallback would
  // otherwise produce OPENCODE_GO_API_KEY which pi doesn't recognise.
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
};

function envVarFor(provider: string): string {
  return PROVIDER_KEY_VAR[provider] ?? `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
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

function load(): Record<string, string> {
  if (cache) return cache;
  const root = findMonorepoRoot(process.cwd());
  const path = join(root, ".env.harness");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  cache = parseEnvFile(text);
  return cache;
}

export function getApiKey(provider: string): string {
  const vars = load();
  const name = envVarFor(provider);
  const v = vars[name] ?? process.env[name];
  if (!v) throw new AuthError(`missing API key for ${provider} (expected ${name} in .env.harness)`);
  return v;
}

// Test-only: drop the cache so tests can reload .env.harness between cases.
export function __resetAuthCache(): void {
  cache = null;
}
