import {
  PhaseEventLogStore,
  type BrainstormPhaseEventInput,
} from "../adapters/phase-event-log-store.js";
import { mkEventAt } from "../domain/events.js";

export type BrainstormEventInput = BrainstormPhaseEventInput;

export class BrainstormEventBus {
  constructor(
    private readonly opts: BrainstormEventBusOpts,
  ) {}

  // Durable-first: write to the JSONL log before broadcasting via EventStore.
  // If the JSONL write fails, the EventStore append is skipped so consumers
  // (dashboard SSE) don't see an event that doesn't exist in the branch's
  // history. Throws on JSONL failure so the caller can surface it.
  async publish(input: BrainstormEventInput): Promise<void> {
    if ("phaseEvents" in this.opts) {
      await this.opts.phaseEvents.publish({
        phase: "brainstorm",
        worktreePath: this.opts.worktreePath,
        taskId: this.opts.taskId,
        runId: this.opts.runId,
        input,
      });
      return;
    }

    const ts = new Date();
    await this.opts.jsonl.append({
      ts: ts.toISOString(),
      ...input,
    });
    await this.opts.eventStore.append(mkEventAt({
      runId: this.opts.runId,
      taskId: this.opts.taskId,
      ...input,
    }, ts));
  }
}

type BrainstormEventBusOpts =
  | {
      readonly phaseEvents: Pick<PhaseEventLogStore, "publish">;
      readonly worktreePath: string;
      readonly runId: string;
      readonly taskId: string;
    }
  | {
      readonly eventStore: { append(event: unknown): Promise<void> };
      readonly jsonl: { append(event: Record<string, unknown>): Promise<void> };
      readonly runId: string;
      readonly taskId: string;
    };
