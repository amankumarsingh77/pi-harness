import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAgentSession } from "@pi-harness/pi-bridge";
import { loadConfig } from "./config.js";
import { RunStore } from "./adapters/run-store.js";
import { EventStore } from "./adapters/event-store.js";
import { LiveEventStore } from "./adapters/live-event-store.js";
import { ClaimLedgerStore, MissionStore } from "./adapters/mission-store.js";
import { WorktreeManager } from "./adapters/worktree.js";
import { ArtifactsStore } from "./agents/artifacts-store.js";
import { deriveBrainstormGate } from "./agents/brainstorm-gate.js";
import { GraphifyManager } from "./agents/graphify-manager.js";
import { createPinoLogger, fromPino } from "./domain/logger.js";
import { reconcileWorktrees } from "./runner/janitor.js";
import { TaskScheduler } from "./runner/scheduler.js";
import { CancellationRegistry } from "./runner/cancellation.js";
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
    { port: config.port, stateDir: config.stateDir, level: config.logLevel, format: config.logFormat },
    "boot",
  );

  const liveEvents = new LiveEventStore({ stateDir: config.stateDir });
  const runs = new RunStore({ stateDir: config.stateDir }, {
    onTaskChanged: async (task) => {
      await liveEvents.publishTask(task);
    },
    onRunChanged: async (run) => {
      await liveEvents.publishRun(run);
    },
  });
  const events = new EventStore({ stateDir: config.stateDir }, liveEvents);
  const missionStore = new MissionStore({ stateDir: config.stateDir });
  const claimLedger = new ClaimLedgerStore({ stateDir: config.stateDir });
  const worktrees = new WorktreeManager({
    repoRoot: config.repoRoot,
    worktreesDir: config.worktreesDir,
    baseBranch: config.baseBranch,
  });
  const artifacts = new ArtifactsStore();
  const graphify = new GraphifyManager();

  void graphify.ensureInitialized(config.repoRoot)
    .then((result) => {
      if (result.ok) {
        log.info(
          {
            graphPath: result.status.graphPath,
            nodeCount: result.status.nodeCount,
            edgeCount: result.status.edgeCount,
            skipped: result.skipped,
          },
          "graphify repo graph ready",
        );
        return;
      }
      log.warn(
        { code: result.code, message: result.message },
        "graphify repo graph initialization failed",
      );
    })
    .catch((err) => {
      log.warn({ err }, "graphify repo graph initialization crashed");
    });

  const allTasks = await runs.listTasks();
  const activeTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const activeIds = new Set(activeTasks.map((t) => t.id));
  const report = await reconcileWorktrees({ worktreeManager: worktrees, activeTaskIds: activeIds });
  log.info(
    { kept: report.kept.length, removed: report.removed.length },
    "janitor reconcile complete",
  );

  // Shared phase deps. Brainstorm, plan, and code use real pi sessions;
  // verify/pr still return a structured `not_implemented` until migrated.
  const phaseDeps: PhaseDeps = {
    cwd: config.repoRoot, // overridden per-task by run-loop
    onEvent: () => {},
    createAgentSession,
    store: artifacts,
    eventStore: events,
    claimLedger,
    claimPublisher: liveEvents,
    graphify,
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

  const cancellation = new CancellationRegistry();
  const scheduler = new TaskScheduler({
    runs,
    events,
    phaseDeps,
    worktrees,
    retryCap: config.retryCap,
    cancellation,
    graphify,
    logger: log.child({ component: "scheduler" }),
  });

  // Recovery sweep: re-enqueue every non-terminal task so the agent picks up
  // where it left off after a restart. The run-loop is idempotent on JSONL
  // state (cursor recomputes from events).
  for (const t of activeTasks) {
    if (t.status === "brainstorming" && t.worktreePath) {
      const gate = await deriveBrainstormGate(t.worktreePath, t.id, artifacts);
      if (gate === "awaiting_user") continue; // gated on user
    }
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
    stateDir: config.stateDir,
    missionStore,
    claimLedger,
    scheduler,
    cancellation,
    pinoLogger: pinoRoot,
    liveEvents,
  });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port }, "orchestrator listening");
}

main().catch((e) => {
  // No structured logger here yet — fatal during boot, write the raw error
  // to stderr so the process supervisor sees it.
  console.error("fatal:", e);
  process.exit(1);
});
