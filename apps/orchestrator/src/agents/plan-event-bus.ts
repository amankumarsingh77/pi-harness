import {
  PhaseEventLogStore,
  type PlanPhaseEventInput,
} from "../adapters/phase-event-log-store.js";
import { mkEventAt } from "../domain/events.js";

export type PlanEventInput = PlanPhaseEventInput;

export class PlanEventBus {
  constructor(
    private readonly opts: PlanEventBusOpts,
  ) {}

  // Durable-first: write to plan.jsonl before broadcasting via EventStore.
  // Same posture as BrainstormEventBus — a JSONL failure short-circuits the
  // EventStore append so the dashboard never sees an event that isn't on disk.
  async publish(input: PlanEventInput): Promise<void> {
    if ("phaseEvents" in this.opts) {
      await this.opts.phaseEvents.publish({
        phase: "plan",
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

type PlanEventBusOpts =
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
