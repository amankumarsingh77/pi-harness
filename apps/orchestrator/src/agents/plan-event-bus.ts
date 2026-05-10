import type { AgentEvent } from "@pi-harness/shared";
import type { EventStore } from "../adapters/event-store.js";
import type { JsonlWriter } from "../adapters/jsonl-writer.js";
import { mkEvent } from "../domain/events.js";

// Plan event payload: a slice of AgentEvent restricted to the plan kinds
// (plus the generic kinds the planner tick republishes), minus envelope
// fields the bus fills in. Mirrors brainstorm-event-bus exactly so
// downstream consumers can use the same shape.
type PlanKind =
  | "plan_system"
  | "plan_subagent_started"
  | "plan_subagent_ended"
  | "plan_revision_requested"
  | "plan_usage"
  | "plan_artifact_edited";

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type PlanEventInput = DistributiveOmit<
  Extract<AgentEvent, { kind: PlanKind }>,
  "id" | "ts" | "runId" | "taskId"
>;

export class PlanEventBus {
  constructor(
    private readonly opts: {
      eventStore: EventStore;
      jsonl: JsonlWriter;
      runId: string;
      taskId: string;
    },
  ) {}

  // Durable-first: write to plan.jsonl before broadcasting via EventStore.
  // Same posture as BrainstormEventBus — a JSONL failure short-circuits the
  // EventStore append so the dashboard never sees an event that isn't on disk.
  async publish(input: PlanEventInput): Promise<void> {
    const ts = new Date();
    const jsonlPayload: Record<string, unknown> = {
      ts: ts.toISOString(),
      ...input,
    };
    await this.opts.jsonl.append(jsonlPayload);

    const event = mkEvent({
      runId: this.opts.runId,
      taskId: this.opts.taskId,
      ...input,
    });
    await this.opts.eventStore.append(event);
  }
}
