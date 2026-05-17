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
  type CustomTool,
} from "./metadata.js";

export { PREFLIGHT_SUBAGENTS, RETIRED_PROMPTS };
export type { SubagentRole, BuiltinTool, CustomTool };

// Anchor relative to this module's location, but tolerate dist mode. The
// package compiles index.ts + registry.ts into subagents/dist/; prompt
// markdown stays under subagents/prompts/ and is read directly by the
// orchestrator in source/worktree deployments.
// Returns null if the source prompt tree is not on disk. Consumers that need
// promptPath validate it; metadata-only consumers can still import registry
// data in deployed builds that do not ship prompt markdown.
function findSubagentsRoot(): string | null {
  let here = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(here, "prompts"))) {
      return here;
    }
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  return null;
}

const SUBAGENTS_ROOT = findSubagentsRoot();
export const PROMPTS_DIR = SUBAGENTS_ROOT ? resolve(SUBAGENTS_ROOT, "prompts") : "";
export const PHASE_PROMPTS_DIR = PROMPTS_DIR ? resolve(PROMPTS_DIR, "phase") : "";
export const RESEARCH_PROMPTS_DIR = PROMPTS_DIR ? resolve(PROMPTS_DIR, "research") : "";
export const AUDIT_PROMPTS_DIR = PROMPTS_DIR ? resolve(PROMPTS_DIR, "audit") : "";
export const RETIRED_PROMPTS_DIR = PROMPTS_DIR ? resolve(PROMPTS_DIR, "retired") : "";

export type SubagentDef = Omit<SubagentMeta, "promptDir" | "promptFile"> & {
  promptPath: string;
};

function withPromptPath(meta: SubagentMeta): SubagentDef {
  const dir = promptDir(meta.promptDir);
  const { promptDir: _promptDir, promptFile, ...rest } = meta;
  return { ...rest, promptPath: resolve(dir, promptFile) };
}

function promptDir(dir: SubagentMeta["promptDir"]): string {
  switch (dir) {
    case "phase":
      return PHASE_PROMPTS_DIR;
    case "research":
      return RESEARCH_PROMPTS_DIR;
    case "audit":
      return AUDIT_PROMPTS_DIR;
  }
}

// Single source of truth for prompt-path-resolved registry. The metadata
// itself lives in `metadata.ts` so browser bundles can import names/roles
// without dragging in node:fs.
export const SUBAGENTS: Record<string, SubagentDef> = Object.fromEntries(
  Object.entries(SUBAGENT_META).map(([key, meta]) => [key, withPromptPath(meta)]),
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
