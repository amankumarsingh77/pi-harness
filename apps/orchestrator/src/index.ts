import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDb } from "@pi-harness/db";
import { loadConfig } from "./config.js";
import { RunStore } from "./adapters/run-store.js";
import { EventStore } from "./adapters/event-store.js";
import { WorktreeManager } from "./adapters/worktree.js";
import { ArtifactsStore } from "./agents/artifacts-store.js";
import { reconcileWorktrees } from "./runner/janitor.js";
import { TaskScheduler } from "./runner/scheduler.js";
import type { PhaseDeps } from "./runner/phase-prompts.js";
import { buildServer } from "./http/server.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const config = loadConfig();
  const { db } = createDb(config.databaseUrl);

  const runs = new RunStore(db);
  const events = new EventStore(db);
  const worktrees = new WorktreeManager({
    repoRoot: config.repoRoot,
    worktreesDir: config.worktreesDir,
  });
  const artifacts = new ArtifactsStore({ runsDir: config.runsDir });

  const allTasks = await runs.listTasks();
  const activeTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const activeIds = new Set(activeTasks.map((t) => t.id));
  const report = await reconcileWorktrees({ worktreeManager: worktrees, activeTaskIds: activeIds });
  // eslint-disable-next-line no-console
  console.log(`[janitor] kept=${report.kept.length} removed=${report.removed.length}`);

  // Brainstorm-sufficient phaseDeps. Plan/code/verify/pr will fail loudly
  // until pi-bridge wiring lands — better than silently no-op'ing past the
  // point where an LLM-driven phase should run.
  const phaseDeps: PhaseDeps = {
    cwd: config.repoRoot, // overridden per-task by run-loop
    onEvent: () => {},
    createSession: async () => {
      throw new Error("createSession not wired: pi-bridge integration is mocked");
    },
    runSubagent: async () => {
      throw new Error("runSubagent not wired: pi-bridge integration is mocked");
    },
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
  });

  // Recovery sweep: re-enqueue every non-terminal task so the agent picks up
  // where it left off after a restart. The run-loop is idempotent on JSONL
  // state (cursor recomputes from events).
  for (const t of activeTasks) {
    if (t.status === "brainstorming" && t.awaitingApproval) continue; // gated on user
    scheduler.enqueue(t.id);
  }
  // eslint-disable-next-line no-console
  console.log(`[scheduler] recovered ${activeTasks.length} non-terminal tasks`);

  const app = buildServer({ runs, events, runsDir: config.runsDir, scheduler });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[orchestrator] listening on :${config.port}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
