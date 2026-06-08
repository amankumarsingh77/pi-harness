// Pure metadata view of the subagent registry. No fs / path / url imports —
// safe to import from browser bundles (e.g. the dashboard plan page) where
// only names, roles, and descriptions are needed. The full registry in
// `registry.ts` consumes these definitions and adds resolved promptPath
// values that depend on Node built-ins.

import type { Phase } from "@pi-harness/shared";

export type SubagentRole =
  | "phase-driver"
  | "brainstorm-research"
  | "plan-research"
  | "post-plan-audit";

export type BuiltinTool =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "bash"
  | "edit"
  | "write";

export type CustomTool =
  | "read_artifact"
  | "write_artifact"
  | "submit_questions"
  | "submit_mocks"
  | "submit_mock_revision"
  | "reply_to_user"
  | "mark_ready"
  | "pi_web_search"
  | "pi_web_fetch"
  | "write_findings"
  | "return_findings"
  | "git_history"
  | "spawn_plan_agent"
  | "write_plan_artifact";

export type SubagentMeta = {
  name: string;
  role: SubagentRole;
  // Path is resolved relative to subagents/prompts, so
  // the metadata layer can describe it without touching the filesystem.
  promptDir: "phase" | "research" | "audit";
  promptFile: string;
  allowedTools: readonly BuiltinTool[];
  customTools?: readonly CustomTool[];
  invokedBy: readonly Phase[];
  framing: string;
  description: string;
};

export const SUBAGENT_META: Record<string, SubagentMeta> = {
  brainstorm: {
    name: "brainstorm",
    role: "phase-driver",
    promptDir: "phase",
    promptFile: "brainstorm.md",
    allowedTools: ["read"],
    customTools: [
      "read_artifact",
      "write_artifact",
      "submit_questions",
      "submit_mocks",
      "submit_mock_revision",
      "mark_ready",
      "reply_to_user",
      "pi_web_search",
      "pi_web_fetch",
    ],
    invokedBy: ["brainstorm"],
    framing: "",
    description: "Drives the Q&A loop and writes design.md + spec.md",
  },
  plan: {
    name: "plan",
    role: "phase-driver",
    promptDir: "phase",
    promptFile: "plan.md",
    allowedTools: ["read", "grep", "find"],
    customTools: ["spawn_plan_agent", "write_plan_artifact", "mark_ready"],
    invokedBy: ["plan"],
    framing: "",
    description: "Reads research findings, authors plan.md + scenarios.yaml",
  },
  code: {
    name: "code",
    role: "phase-driver",
    promptDir: "phase",
    promptFile: "code.md",
    allowedTools: ["read", "grep", "find", "ls", "bash", "edit"],
    customTools: [],
    invokedBy: ["code"],
    framing: "",
    description: "Executes one execution DAG node without committing",
  },
  "codebase-scout": {
    name: "codebase-scout",
    role: "plan-research",
    promptDir: "research",
    promptFile: "codebase-scout.md",
    allowedTools: ["read", "grep", "find", "ls"],
    customTools: [
      "write_findings",
    ],
    invokedBy: ["plan"],
    framing:
      "Scout the codebase end-to-end for this ticket. Produce a single findings doc with three sections: Files (every file to be read or modified), Patterns (analogous code with file:line cites), Call paths (how the relevant flows work today).",
    description: "One-pass codebase research: files + patterns + call paths",
  },
  "web-search-researcher": {
    name: "web-search-researcher",
    role: "brainstorm-research",
    promptDir: "research",
    promptFile: "web-search-researcher.md",
    allowedTools: ["read", "grep", "find", "ls"],
    customTools: [
      "pi_web_search",
      "pi_web_fetch",
      "write_findings",
    ],
    invokedBy: ["brainstorm"],
    framing:
      "Research external libraries, APIs, pricing, recent approaches, and source-backed alternatives before brainstorm asks the user questions.",
    description: "Searches the web for current external context",
  },
  "integration-scanner": {
    name: "integration-scanner",
    role: "plan-research",
    promptDir: "research",
    promptFile: "integration-scanner.md",
    allowedTools: ["read", "grep", "find", "ls"],
    customTools: [
      "write_findings",
    ],
    invokedBy: ["plan"],
    framing:
      "Identify inbound and outbound system edges affected by this ticket.",
    description: "Identifies inbound/outbound system edges",
  },
  "precedent-locator": {
    name: "precedent-locator",
    role: "plan-research",
    promptDir: "research",
    promptFile: "precedent-locator.md",
    allowedTools: ["read", "grep", "find", "ls"],
    customTools: [
      "git_history",
      "write_findings",
    ],
    invokedBy: ["plan"],
    framing:
      "Find past similar changes from git history and what went wrong with each one.",
    description: "Finds prior similar changes from git history",
  },
  "claim-verifier": {
    name: "claim-verifier",
    role: "post-plan-audit",
    promptDir: "audit",
    promptFile: "claim-verifier.md",
    allowedTools: ["read", "grep", "find", "ls"],
    customTools: [
      "git_history",
      "write_findings",
    ],
    invokedBy: ["plan"],
    framing: "",
    description: "Audits the planner's draft plan.md, tags claims",
  },
};

// Derived view: ordering follows SUBAGENT_META declaration order, which the
// dashboard relies on for stable dot positions.
export const PLAN_RESEARCH_SUBAGENTS: readonly string[] = Object.values(SUBAGENT_META)
  .filter((s) => s.role === "plan-research")
  .map((s) => s.name);
