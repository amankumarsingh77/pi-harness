import "dotenv/config";

export type OrchestratorConfig = {
  port: number;
  databaseUrl: string;
  runsDir: string;
  worktreesDir: string;
  // Hard cap on retries per task before requiring human triage.
  // Spec §8.3: cap = 2 retries.
  retryCap: number;
  // Concurrent tasks in `executing`.
  // Spec §4: default 2.
  executingConcurrency: number;
  // Path to repo root the harness operates on. Worktrees branch off this repo's HEAD.
  // For now this is the same repo the orchestrator runs from; multi-repo support is v2.
  repoRoot: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    port: parseInt(env.PORT ?? "4000", 10),
    databaseUrl:
      env.DATABASE_URL ??
      "postgresql://piharness:piharness@localhost:5433/piharness",
    runsDir: env.HARNESS_RUNS_DIR ?? ".harness/runs",
    worktreesDir: env.HARNESS_WORKTREES_DIR ?? ".harness/worktrees",
    retryCap: parseInt(env.HARNESS_RETRY_CAP ?? "2", 10),
    executingConcurrency: parseInt(env.HARNESS_EXECUTING_CONCURRENCY ?? "2", 10),
    repoRoot: env.HARNESS_REPO_ROOT ?? process.cwd(),
  };
}
