import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Phase } from "@pi-harness/shared";

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

export type SubagentRole =
  | "phase-driver"
  | "preflight-research"
  | "post-plan-audit";

export type BuiltinTool =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "bash"
  | "edit"
  | "write";

export type SubagentDef = {
  name: string;
  role: SubagentRole;
  promptPath: string;
  allowedTools: readonly BuiltinTool[];
  invokedBy: readonly Phase[];
  // One-line per-ticket job framing the dispatcher inlines into the user
  // prompt. Empty for phase-drivers — they build their own prompts.
  framing: string;
  // Human-readable one-liner for the dashboard agent drawer.
  description: string;
};

// Single source of truth. Adding/renaming a subagent means editing this map
// and nothing else (callers consume derived views).
export const SUBAGENTS: Record<string, SubagentDef> = {
  brainstorm: {
    name: "brainstorm",
    role: "phase-driver",
    promptPath: resolve(OURS_DIR, "brainstorm.md"),
    allowedTools: ["read", "grep", "find", "ls", "edit", "write"],
    invokedBy: ["brainstorm"],
    framing: "",
    description: "Drives the Q&A loop and writes design.md + spec.md",
  },
  plan: {
    name: "plan",
    role: "phase-driver",
    promptPath: resolve(OURS_DIR, "plan.md"),
    allowedTools: ["read", "grep", "find", "ls", "edit", "write"],
    invokedBy: ["plan"],
    framing: "",
    description: "Reads research findings, authors plan.md + scenarios.yaml",
  },
  "codebase-scout": {
    name: "codebase-scout",
    role: "preflight-research",
    promptPath: resolve(VENDORED_DIR, "codebase-scout.md"),
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing:
      "Scout the codebase end-to-end for this ticket. Produce a single findings doc with three sections: Files (every file to be read or modified), Patterns (analogous code with file:line cites), Call paths (how the relevant flows work today).",
    description: "One-pass codebase research: files + patterns + call paths",
  },
  "integration-scanner": {
    name: "integration-scanner",
    role: "preflight-research",
    promptPath: resolve(VENDORED_DIR, "integration-scanner.md"),
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing:
      "Identify inbound and outbound system edges affected by this ticket.",
    description: "Identifies inbound/outbound system edges",
  },
  "precedent-locator": {
    name: "precedent-locator",
    role: "preflight-research",
    promptPath: resolve(VENDORED_DIR, "precedent-locator.md"),
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing:
      "Find past similar changes from git history and what went wrong with each one.",
    description: "Finds prior similar changes from git history",
  },
  "claim-verifier": {
    name: "claim-verifier",
    role: "post-plan-audit",
    promptPath: resolve(VENDORED_DIR, "claim-verifier.md"),
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing: "",
    description: "Audits the planner's draft plan.md, tags claims",
  },
};

// Filenames intentionally kept on disk but not wired into any phase yet.
// Loader test asserts the union of (registry, retired) covers every .md.
export const RETIRED_PROMPTS = [
  "scope-tracer",
  "test-case-locator",
  "thoughts-analyzer",
  "thoughts-locator",
  "web-search-researcher",
  "peer-comparator",
  "diff-auditor",
  "proof-capture",
  "screenshot-taker",
  "verification-author",
  // Merged into codebase-scout. Prompts kept on disk for revivability.
  "codebase-locator",
  "codebase-pattern-finder",
  "codebase-analyzer",
] as const;

// Derived view: ordering follows SUBAGENTS declaration order, which the
// dashboard relies on for stable dot positions.
export const PREFLIGHT_SUBAGENTS: readonly string[] = Object.values(SUBAGENTS)
  .filter((s) => s.role === "preflight-research")
  .map((s) => s.name);

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
