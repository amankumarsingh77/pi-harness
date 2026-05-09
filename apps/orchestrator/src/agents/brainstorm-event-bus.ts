import type { BrainstormOption } from "@pi-harness/shared";
import type { EventStore } from "../adapters/event-store.js";
import type { JsonlWriter } from "../adapters/jsonl-writer.js";
import { mkEvent } from "../domain/events.js";

// Brainstorm-specific event payloads (sans the runId/taskId/id/ts envelope —
// those are filled in here). The bus is the single emit point for every
// brainstorm event so callers can't accidentally publish to one sink and
// not the other.
export type BrainstormEventInput =
  | {
      kind: "brainstorm_question";
      questionId: string;
      prompt: string;
      options: BrainstormOption[];
      sectionTarget: { artifact: "design" | "spec"; section: string };
      multiSelect?: boolean;
    }
  | {
      kind: "brainstorm_answer";
      questionId: string;
      optionId?: string;
      optionIds?: string[];
      freeText?: string;
    }
  | {
      kind: "brainstorm_system";
      systemKind:
        | "probe_complete"
        | "self_critique_passed"
        | "status_changed"
        | "blocked"
        | "session_reset";
      data?: Record<string, unknown>;
    }
  | {
      kind: "brainstorm_revision_requested";
      comment: string;
    };

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

    // mkEvent's input union mirrors AgentEvent's; the cast is safe because
    // BrainstormEventInput's kinds are a strict subset.
    const event = mkEvent({
      runId: this.opts.runId,
      taskId: this.opts.taskId,
      ...input,
    } as Parameters<typeof mkEvent>[0]);
    await this.opts.eventStore.append(event);
  }
}
