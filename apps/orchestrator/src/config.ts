import "dotenv/config";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import type { LogFormat, LogLevel } from "./domain/logger.js";

export type OrchestratorConfig = {
  port: number;
  stateDir: string;
  runsDir: string;
  worktreesDir: string;
  baseBranch: string;
  // Hard cap on retries per task before requiring human triage.
  // Spec §8.3: cap = 2 retries.
  retryCap: number;
  // Concurrent tasks in `executing`.
  // Spec §4: default 2.
  executingConcurrency: number;
  // Path to repo root the harness operates on. Worktrees branch off this repo's HEAD.
  // For now this is the same repo the orchestrator runs from; multi-repo support is v2.
  repoRoot: string;
  logLevel: LogLevel;
  logFormat: LogFormat;
};

const VALID_LOG_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

function parseLogLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  if (!raw) return fallback;
  return (VALID_LOG_LEVELS as readonly string[]).includes(raw)
    ? (raw as LogLevel)
    : fallback;
}

function parseLogFormat(raw: string | undefined, fallback: LogFormat): LogFormat {
  if (raw === "json" || raw === "pretty") return raw;
  return fallback;
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
): OrchestratorConfig {
  const isProd = env.NODE_ENV === "production";
  const repoRoot = resolveRepoRoot(env.HARNESS_REPO_ROOT, cwd);
  const stateDir = resolveConfigPath(repoRoot, env.HARNESS_STATE_DIR ?? ".harness");
  return {
    port: parseInt(env.PORT ?? "4000", 10),
    stateDir,
    runsDir: env.HARNESS_RUNS_DIR ? resolveConfigPath(repoRoot, env.HARNESS_RUNS_DIR) : join(stateDir, "runs"),
    worktreesDir: env.HARNESS_WORKTREES_DIR
      ? resolveConfigPath(repoRoot, env.HARNESS_WORKTREES_DIR)
      : join(stateDir, "worktrees"),
    baseBranch: env.HARNESS_BASE_BRANCH ?? "main",
    retryCap: parseInt(env.HARNESS_RETRY_CAP ?? "2", 10),
    executingConcurrency: parseInt(env.HARNESS_EXECUTING_CONCURRENCY ?? "2", 10),
    repoRoot,
    // Default level: info in prod, debug elsewhere. LOG_LEVEL overrides.
    logLevel: parseLogLevel(env.LOG_LEVEL, isProd ? "info" : "debug"),
    // Default format: json in prod, pretty in dev. LOG_FORMAT overrides.
    logFormat: parseLogFormat(env.LOG_FORMAT, isProd ? "json" : "pretty"),
  };
}

function resolveRepoRoot(raw: string | undefined, cwd: string): string {
  if (raw) return resolveConfigPath(cwd, raw);
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return resolve(cwd);
  }
}

function resolveConfigPath(base: string, path: string): string {
  return isAbsolute(path) ? path : resolve(base, path);
}
