import { existsSync, readdirSync } from "node:fs";

export {
  SUBAGENTS,
  PLAN_RESEARCH_SUBAGENTS,
  PROMPTS_DIR,
  PHASE_PROMPTS_DIR,
  RESEARCH_PROMPTS_DIR,
  AUDIT_PROMPTS_DIR,
  getSubagent,
  type SubagentDef,
  type SubagentRole,
  type BuiltinTool,
  type CustomTool,
} from "./registry.js";

import {
  AUDIT_PROMPTS_DIR,
  PHASE_PROMPTS_DIR,
  RESEARCH_PROMPTS_DIR,
} from "./registry.js";

// On-disk listings used by the loader test to assert every active .md prompt
// is registered.
export function listPromptAgents(): string[] {
  return listActivePromptAgents();
}

export function listActivePromptAgents(): string[] {
  return [
    ...listPromptNames(PHASE_PROMPTS_DIR),
    ...listPromptNames(RESEARCH_PROMPTS_DIR),
    ...listPromptNames(AUDIT_PROMPTS_DIR),
  ].sort();
}

function listPromptNames(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}
