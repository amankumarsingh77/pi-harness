// Pure metadata view of the subagent registry. No fs / path / url imports —
// safe to import from browser bundles (e.g. the dashboard plan page) where
// only names, roles, and descriptions are needed. The full registry in
// `registry.ts` consumes these definitions and adds resolved promptPath
// values that depend on Node built-ins.

import type { Phase } from "@pi-harness/shared";

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

export type SubagentMeta = {
  name: string;
  role: SubagentRole;
  // Path is resolved relative to the subagents root (_vendored or ours), so
  // the metadata layer can describe it without touching the filesystem.
  promptDir: "vendored" | "ours";
  promptFile: string;
  allowedTools: readonly BuiltinTool[];
  invokedBy: readonly Phase[];
  framing: string;
  description: string;
};

export const SUBAGENT_META: Record<string, SubagentMeta> = {
  brainstorm: {
    name: "brainstorm",
    role: "phase-driver",
    promptDir: "ours",
    promptFile: "brainstorm.md",
    allowedTools: ["read", "grep", "find", "ls", "edit", "write"],
    invokedBy: ["brainstorm"],
    framing: "",
    description: "Drives the Q&A loop and writes design.md + spec.md",
  },
  plan: {
    name: "plan",
    role: "phase-driver",
    promptDir: "ours",
    promptFile: "plan.md",
    allowedTools: ["read", "grep", "find", "ls", "edit", "write"],
    invokedBy: ["plan"],
    framing: "",
    description: "Reads research findings, authors plan.md + scenarios.yaml",
  },
  "codebase-scout": {
    name: "codebase-scout",
    role: "preflight-research",
    promptDir: "vendored",
    promptFile: "codebase-scout.md",
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing:
      "Scout the codebase end-to-end for this ticket. Produce a single findings doc with three sections: Files (every file to be read or modified), Patterns (analogous code with file:line cites), Call paths (how the relevant flows work today).",
    description: "One-pass codebase research: files + patterns + call paths",
  },
  "integration-scanner": {
    name: "integration-scanner",
    role: "preflight-research",
    promptDir: "vendored",
    promptFile: "integration-scanner.md",
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing:
      "Identify inbound and outbound system edges affected by this ticket.",
    description: "Identifies inbound/outbound system edges",
  },
  "precedent-locator": {
    name: "precedent-locator",
    role: "preflight-research",
    promptDir: "vendored",
    promptFile: "precedent-locator.md",
    allowedTools: ["read", "grep", "find", "ls"],
    invokedBy: ["plan"],
    framing:
      "Find past similar changes from git history and what went wrong with each one.",
    description: "Finds prior similar changes from git history",
  },
  "claim-verifier": {
    name: "claim-verifier",
    role: "post-plan-audit",
    promptDir: "vendored",
    promptFile: "claim-verifier.md",
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

// Derived view: ordering follows SUBAGENT_META declaration order, which the
// dashboard relies on for stable dot positions.
export const PREFLIGHT_SUBAGENTS: readonly string[] = Object.values(SUBAGENT_META)
  .filter((s) => s.role === "preflight-research")
  .map((s) => s.name);
