import { readdirSync, existsSync } from "node:fs";

export {
  SUBAGENTS,
  PREFLIGHT_SUBAGENTS,
  RETIRED_PROMPTS,
  VENDORED_DIR,
  OURS_DIR,
  getSubagent,
  type SubagentDef,
  type SubagentRole,
  type BuiltinTool,
  type CustomTool,
} from "./registry.js";

import { VENDORED_DIR, OURS_DIR } from "./registry.js";

// On-disk listings used by the loader test to assert that every .md is either
// in the registry or on the explicit retired allowlist.
export function listVendoredAgents(): string[] {
  return readdirSync(VENDORED_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

export function listOurAgents(): string[] {
  if (!existsSync(OURS_DIR)) return [];
  return readdirSync(OURS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}
