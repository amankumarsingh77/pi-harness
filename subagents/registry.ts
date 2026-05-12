import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBAGENT_META,
  PREFLIGHT_SUBAGENTS,
  RETIRED_PROMPTS,
  type SubagentMeta,
  type SubagentRole,
  type BuiltinTool,
} from "./metadata.js";

export { PREFLIGHT_SUBAGENTS, RETIRED_PROMPTS };
export type { SubagentRole, BuiltinTool };

// Anchor relative to this module's location, but tolerate dist mode. The
// package compiles index.ts + registry.ts into subagents/dist/ — the .md
// prompt files stay in subagents/_vendored/ and subagents/ours/ (not copied).
// So we walk up from import.meta.url until we find a directory that has
// _vendored/ and ours/ as siblings of the current location.
// Walk up from this module to find the subagents root (where _vendored/ and
// ours/ live as siblings). Returns null if not found — that's the case when
// the package is consumed by a deployed dashboard build that doesn't ship
// the .md prompt files. Consumers that need the paths (orchestrator) check
// promptPath; consumers that need only metadata (dashboard) don't.
function findSubagentsRoot(): string | null {
  let here = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (
      existsSync(resolve(here, "_vendored")) &&
      existsSync(resolve(here, "ours"))
    ) {
      return here;
    }
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  return null;
}

const SUBAGENTS_ROOT = findSubagentsRoot();
export const VENDORED_DIR = SUBAGENTS_ROOT ? resolve(SUBAGENTS_ROOT, "_vendored") : "";
export const OURS_DIR = SUBAGENTS_ROOT ? resolve(SUBAGENTS_ROOT, "ours") : "";

export type SubagentDef = Omit<SubagentMeta, "promptDir" | "promptFile"> & {
  promptPath: string;
};

function withPromptPath(meta: SubagentMeta): SubagentDef {
  const dir = meta.promptDir === "ours" ? OURS_DIR : VENDORED_DIR;
  const { promptDir: _d, promptFile, ...rest } = meta;
  return { ...rest, promptPath: resolve(dir, promptFile) };
}

// Single source of truth for prompt-path-resolved registry. The metadata
// itself lives in `metadata.ts` so browser bundles can import names/roles
// without dragging in node:fs.
export const SUBAGENTS: Record<string, SubagentDef> = Object.fromEntries(
  Object.entries(SUBAGENT_META).map(([k, m]) => [k, withPromptPath(m)]),
);

export function getSubagent(name: string): SubagentDef {
  const def = SUBAGENTS[name];
  if (!def) throw new Error(`unknown subagent: ${name}`);
  return def;
}

// Boot-time validation. Throws when the subagents source tree is reachable
// but a registered prompt is missing — that's a developer error. Skipped
// when the source tree isn't on disk (deployed dashboard); in that mode the
// dashboard only consumes metadata (names, descriptions) and never reads
// promptPath.
function assertAllPromptsExist(): void {
  if (!SUBAGENTS_ROOT) return;
  const missing: string[] = [];
  for (const def of Object.values(SUBAGENTS)) {
    if (!existsSync(def.promptPath) || !statSync(def.promptPath).isFile()) {
      missing.push(`${def.name} -> ${def.promptPath}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `subagents/registry: missing prompt file(s):\n  ${missing.join("\n  ")}`,
    );
  }
}

assertAllPromptsExist();
