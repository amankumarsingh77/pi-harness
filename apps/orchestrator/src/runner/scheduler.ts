import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import type { WorktreeManager } from "../adapters/worktree.js";
import type { PhaseDeps } from "./phase-prompts.js";
import { consoleLogger, type Logger } from "../domain/logger.js";
import { mkEvent } from "../domain/events.js";
import { runLoop } from "./run-loop.js";

export type SchedulerDeps = {
  runs: RunStore;
  events: EventStore;
  phaseDeps: PhaseDeps;
  worktrees: WorktreeManager;
  retryCap: number;
  logger?: Logger;
};

/**
 * Per-task work scheduler. The orchestrator's HTTP routes don't call runLoop
 * directly — they hand the taskId to this scheduler, which:
 *
 *   - serializes per task (one in-flight tick per taskId, no concurrent
 *     writes to the same task's worktree / JSONL / DB rows);
 *   - coalesces wakeups (an enqueue arriving mid-tick schedules exactly one
 *     re-tick after the current one, never a queue of stale ticks);
 *   - catches all errors, logging them to EventStore, so a poisoned tick
 *     can't crash the scheduler or other tasks' work;
 *   - exposes drain() for graceful shutdown.
 *
 * v1 is single-process. The scheduler lives in-memory; restarts lose any
 * in-flight ticks but JSONL is durable, so the script cursor recovers on
 * the next enqueue (see startup recovery sweep in index.ts).
 */
export class TaskScheduler {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly queued = new Set<string>();
  private readonly log: Logger;

  constructor(private readonly deps: SchedulerDeps) {
    this.log = deps.logger ?? consoleLogger;
  }

  /**
   * Request a tick for the given task. Returns immediately. If a tick is
   * already running for this task, marks it as needing one more tick after
   * the current finishes; collapsing N enqueues into at most one extra tick.
   */
  enqueue(taskId: string): void {
    if (this.inFlight.has(taskId)) {
      this.queued.add(taskId);
      return;
    }
    const promise = this.tick(taskId).finally(() => {
      this.inFlight.delete(taskId);
      // If something asked for a re-tick while we were running, fire it now.
      if (this.queued.delete(taskId)) this.enqueue(taskId);
    });
    this.inFlight.set(taskId, promise);
  }

  /** Wait until every in-flight tick has settled. Used in tests + shutdown. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
      // A tick may have re-enqueued itself synchronously in .finally(); loop
      // until the map is genuinely empty.
    }
  }

  /** Snapshot for tests / introspection — number of tasks with active ticks. */
  inFlightCount(): number {
    return this.inFlight.size;
  }

  private async tick(taskId: string): Promise<void> {
    let task;
    try {
      task = await this.deps.runs.getTask(taskId);
    } catch (e) {
      // Task vanished between enqueue and tick — nothing to do, no event to
      // append (we have no runId to anchor it).
      this.log.warn(`[scheduler] tick skipped for ${taskId}: ${(e as Error).message}`);
      return;
    }

    try {
      await runLoop({
        task,
        runs: this.deps.runs,
        events: this.deps.events,
        phaseDeps: this.deps.phaseDeps,
        worktrees: this.deps.worktrees,
        retryCap: this.deps.retryCap,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log.error(`[scheduler] tick failed for ${taskId}`, e);
      // Best-effort: surface the failure as a log event on the task. We can't
      // tie it to a run (the failure may have happened before runLoop created
      // one), so we synthesize a runId-less anchor by reusing the taskId.
      try {
        await this.deps.events.append(
          mkEvent({
            runId: taskId,
            taskId,
            kind: "log",
            level: "error",
            text: `scheduler tick failed: ${message}`,
          }),
        );
      } catch {
        // Last-ditch swallow — we don't want to lose the original error in a
        // logging failure cascade.
      }
    }
  }
}
