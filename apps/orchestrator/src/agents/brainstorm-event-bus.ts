import type { AgentEvent } from "@pi-harness/shared";
import type { EventStore } from "../adapters/event-store.js";
import type { JsonlWriter } from "../adapters/jsonl-writer.js";
import { mkEvent } from "../domain/events.js";

// Brainstorm event payload: a slice of AgentEvent restricted to the brainstorm
// kinds, minus the envelope fields the bus fills in (id, ts, runId, taskId).
// Derived from the canonical AgentEvent so the bus can't drift from it.
type BrainstormKind =
  | "brainstorm_question"
  | "brainstorm_answer"
  | "brainstorm_system"
  | "brainstorm_revision_requested"
  | "brainstorm_user_nudge"
  | "brainstorm_usage"
  | "brainstorm_artifact_edited"
  | "brainstorm_agent_reply";

// Distributed Omit: applied per-variant of the union so discriminator-keyed
// fields (questionId, systemKind, …) survive instead of collapsing to never.
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type BrainstormEventInput = DistributiveOmit<
  Extract<AgentEvent, { kind: BrainstormKind }>,
  "id" | "ts" | "runId" | "taskId"
>;

export class BrainstormEventBus {
  constructor(
    private readonly opts: {
      eventStore: EventStore;
      jsonl: JsonlWriter;
      runId: string;
      taskId: string;
    },
  ) {}

  // Durable-first: write to the JSONL log before broadcasting via EventStore.
  // If the JSONL write fails, the EventStore append is skipped so consumers
  // (dashboard SSE) don't see an event that doesn't exist in the branch's
  // history. Throws on JSONL failure so the caller can surface it.
  async publish(input: BrainstormEventInput): Promise<void> {
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
