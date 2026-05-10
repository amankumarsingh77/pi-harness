import { readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VENDORED_DIR = resolve(__dirname, "_vendored");
const OURS_DIR = resolve(__dirname, "ours");

export const EXPECTED_VENDORED_AGENTS = [
  "claim-verifier",
  "codebase-analyzer",
  "codebase-locator",
  "codebase-pattern-finder",
  "diff-auditor",
  "integration-scanner",
  "peer-comparator",
  "precedent-locator",
  "scope-tracer",
  "test-case-locator",
  "thoughts-analyzer",
  "thoughts-locator",
  "web-search-researcher",
] as const;

export type VendoredAgent = (typeof EXPECTED_VENDORED_AGENTS)[number];

export const EXPECTED_OUR_AGENTS = [
  "brainstorm",
  "plan",
  "verification-author",
  "proof-capture",
  "screenshot-taker",
] as const;

export type OurAgent = (typeof EXPECTED_OUR_AGENTS)[number];

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

export function resolveAgentPath(name: string): string {
  const vendored = resolve(VENDORED_DIR, `${name}.md`);
  if (existsSync(vendored)) return vendored;
  const ours = resolve(OURS_DIR, `${name}.md`);
  if (existsSync(ours)) return ours;
  throw new Error(`unknown agent: ${name}`);
}
