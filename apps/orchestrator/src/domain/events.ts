import { randomUUID } from "node:crypto";
import type { AgentEvent, BrainstormOption } from "@pi-harness/shared";

type MkEventInput =
  | { runId: string; taskId: string; kind: "phase_started"; phase: string }
  | { runId: string; taskId: string; kind: "phase_ended"; phase: string; status: "succeeded" | "failed" | "cancelled" }
  | { runId: string; taskId: string; kind: "message_delta"; text: string }
  | { runId: string; taskId: string; kind: "tool_call"; tool: string; input: unknown }
  | { runId: string; taskId: string; kind: "tool_result"; tool: string; ok: boolean }
  | { runId: string; taskId: string; kind: "log"; level: "info" | "warn" | "error"; text: string }
  | {
      runId: string;
      taskId: string;
      kind: "brainstorm_question";
      questionId: string;
      prompt: string;
      options: BrainstormOption[];
      sectionTarget: { artifact: "design" | "spec"; section: string };
      multiSelect?: boolean;
    }
  | {
      runId: string;
      taskId: string;
      kind: "brainstorm_answer";
      questionId: string;
      optionId?: string;
      optionIds?: string[];
      freeText?: string;
    }
  | {
      runId: string;
      taskId: string;
      kind: "brainstorm_system";
      systemKind: "probe_complete" | "self_critique_passed" | "status_changed";
      data?: Record<string, unknown>;
    }
  | {
      runId: string;
      taskId: string;
      kind: "brainstorm_revision_requested";
      comment: string;
    };

export function mkEvent(input: MkEventInput): AgentEvent {
  return { id: randomUUID(), ts: new Date(), ...input } as AgentEvent;
}
