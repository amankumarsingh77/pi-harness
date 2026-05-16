import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export {
  SUBAGENTS,
  PREFLIGHT_SUBAGENTS,
  RETIRED_PROMPTS,
  PROMPTS_DIR,
  PHASE_PROMPTS_DIR,
  RESEARCH_PROMPTS_DIR,
  AUDIT_PROMPTS_DIR,
  RETIRED_PROMPTS_DIR,
  getSubagent,
  type SubagentDef,
  type SubagentRole,
  type BuiltinTool,
  type CustomTool,
} from "./registry.js";

import {
  AUDIT_PROMPTS_DIR,
  PHASE_PROMPTS_DIR,
  PROMPTS_DIR,
  RESEARCH_PROMPTS_DIR,
  RETIRED_PROMPTS_DIR,
} from "./registry.js";

// On-disk listings used by the loader test to assert that every .md is either
// in the registry or on the explicit retired allowlist.
export function listPromptAgents(): string[] {
  return listPromptFiles(PROMPTS_DIR).map(({ name }) => name).sort();
}

export function listActivePromptAgents(): string[] {
  return [
    ...listPromptNames(PHASE_PROMPTS_DIR),
    ...listPromptNames(RESEARCH_PROMPTS_DIR),
    ...listPromptNames(AUDIT_PROMPTS_DIR),
  ].sort();
}

export function listRetiredPromptAgents(): string[] {
  return listPromptNames(RETIRED_PROMPTS_DIR);
}

export function listPromptFiles(
  root: string = PROMPTS_DIR,
): Array<{ readonly name: string; readonly path: string }> {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return listPromptFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [{ name: entry.name.replace(/\.md$/, ""), path }];
  });
}

function listPromptNames(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}
