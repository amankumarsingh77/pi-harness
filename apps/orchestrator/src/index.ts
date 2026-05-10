import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAgentSession } from "@pi-harness/pi-bridge";
import { createDb } from "@pi-harness/db";
import { loadConfig } from "./config.js";
import { RunStore } from "./adapters/run-store.js";
import { EventStore } from "./adapters/event-store.js";
import { WorktreeManager } from "./adapters/worktree.js";
import { ArtifactsStore } from "./agents/artifacts-store.js";
import { createPinoLogger, fromPino } from "./domain/logger.js";
import { reconcileWorktrees } from "./runner/janitor.js";
import { TaskScheduler } from "./runner/scheduler.js";
import type { PhaseDeps } from "./runner/phase-prompts.js";
import { buildServer } from "./http/server.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const config = loadConfig();
  // Root logger. `service` is attached to every line so multi-service
  // log aggregation can route us cleanly. We keep both the pino instance
  // (Fastify wants the raw thing) and the Logger surface (everything else).
  const pinoRoot = createPinoLogger({
    level: config.logLevel,
    format: config.logFormat,
    base: { service: "orchestrator" },
  });
  const log = fromPino(pinoRoot);
  log.info(
    { port: config.port, level: config.logLevel, format: config.logFormat },
    "boot",
  );

  const { db } = createDb(config.databaseUrl);

  const runs = new RunStore(db);
  const events = new EventStore(db);
  const worktrees = new WorktreeManager({
    repoRoot: config.repoRoot,
    worktreesDir: config.worktreesDir,
  });
  const artifacts = new ArtifactsStore();

  const allTasks = await runs.listTasks();
  const activeTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const activeIds = new Set(activeTasks.map((t) => t.id));
  const report = await reconcileWorktrees({ worktreeManager: worktrees, activeTaskIds: activeIds });
  log.info(
    { kept: report.kept.length, removed: report.removed.length },
    "janitor reconcile complete",
  );

  // Brainstorm-sufficient phaseDeps. plan/code/verify/pr return a structured
  // `not_implemented` from runPhase until each migrates to createAgentSession.
  const phaseDeps: PhaseDeps = {
    cwd: config.repoRoot, // overridden per-task by run-loop
    onEvent: () => {},
    createAgentSession,
    store: artifacts,
    eventStore: events,
    exec: async (cmd, args, opts) => {
      try {
        const r = await execFileAsync(cmd, args, opts ?? {});
        return { ok: true, stdout: r.stdout, stderr: r.stderr };
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "" };
      }
    },
  };

  const scheduler = new TaskScheduler({
    runs,
    events,
    phaseDeps,
    worktrees,
    retryCap: config.retryCap,
    logger: log.child({ component: "scheduler" }),
  });

  // Recovery sweep: re-enqueue every non-terminal task so the agent picks up
  // where it left off after a restart. The run-loop is idempotent on JSONL
  // state (cursor recomputes from events).
  for (const t of activeTasks) {
    if (t.status === "brainstorming" && t.awaitingApproval) continue; // gated on user
    scheduler.enqueue(t.id);
  }
  log.info(
    { recovered: activeTasks.length },
    "scheduler recovery sweep complete",
  );

  const app = buildServer({
    runs,
    events,
    runsDir: config.runsDir,
    scheduler,
    pinoLogger: pinoRoot,
  });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port }, "orchestrator listening");
}

main().catch((e) => {
  // No structured logger here yet — fatal during boot, write the raw error
  // to stderr so the process supervisor sees it.
  // eslint-disable-next-line no-console
  console.error("fatal:", e);
  process.exit(1);
});
