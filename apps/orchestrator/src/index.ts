import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAgentSession, loadEnvHarness } from "@pi-harness/pi-bridge";
import { loadConfig } from "./config.js";
import { RunStore } from "./adapters/run-store.js";
import { EventStore } from "./adapters/event-store.js";
import { LiveEventStore } from "./adapters/live-event-store.js";
import { PreflightStepStore } from "./adapters/preflight-step-store.js";
import { ClaimLedgerStore, MissionStore } from "./adapters/mission-store.js";
import { WorktreeManager } from "./adapters/worktree.js";
import { ArtifactsStore } from "./agents/artifacts-store.js";
import { DesignSystemStore } from "./agents/design-system-store.js";
import { MockRenderer } from "./agents/mock-renderer.js";
import { createPinoLogger, fromPino } from "./domain/logger.js";
import { reconcileWorktrees } from "./runner/janitor.js";
import { TaskScheduler } from "./runner/scheduler.js";
import { CancellationRegistry } from "./runner/cancellation.js";
import type { PhaseDeps } from "./runner/phase-prompts.js";
import { buildServer } from "./http/server.js";
import { ChatSessionStore } from "./adapters/chat-store.js";
import { TaskWorkflowService } from "./services/task-workflow-service.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  loadEnvHarness();
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
  const preflightSteps = new PreflightStepStore({ stateDir: config.stateDir });
  const missionStore = new MissionStore({ stateDir: config.stateDir });
  const claimLedger = new ClaimLedgerStore({ stateDir: config.stateDir });
  const worktrees = new WorktreeManager({
    repoRoot: config.repoRoot,
    worktreesDir: config.worktreesDir,
    baseBranch: config.baseBranch,
  });
  const artifacts = new ArtifactsStore({ stateDir: config.stateDir });
  const designSystem = new DesignSystemStore({ stateDir: config.stateDir });
  const mockRenderer = new MockRenderer();

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
    designSystem,
    mockRenderer,
    eventStore: events,
    preflightSteps,
    claimLedger,
    claimPublisher: liveEvents,
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
  const workflow = new TaskWorkflowService({
    runs,
    events,
    artifacts,
    missionStore,
    worktrees,
    phaseDeps,
    retryCap: config.retryCap,
    cancellation,
  });
  const scheduler = new TaskScheduler({
    runs,
    events,
    phaseDeps,
    worktrees,
    retryCap: config.retryCap,
    cancellation,
    workflow,
    logger: log.child({ component: "scheduler" }),
  });
  workflow.setScheduler(scheduler);

  const recovered = await workflow.recoverRunnableTasks();
  log.info(
    { recovered },
    "scheduler recovery sweep complete",
  );

  const chatStore = new ChatSessionStore({ stateDir: config.stateDir });

  const app = buildServer({
    runs,
    events,
    runsDir: config.runsDir,
    stateDir: config.stateDir,
    missionStore,
    claimLedger,
    scheduler,
    cancellation,
    workflow,
    pinoLogger: pinoRoot,
    liveEvents,
    preflightSteps,
    chatStore,
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
