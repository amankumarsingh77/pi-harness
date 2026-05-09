export type AgentEventBase = {
  id: string;
  runId: string;
  taskId: string;
  ts: Date;
};

// Structured option presented to the user for a brainstorm question.
export type BrainstormOption = {
  id: string;
  label: string;
  recommended: boolean;
  evidence: string[];   // e.g. ["src/foo.ts:42"], may be empty
  /** Optional one-line description rendered under the label. */
  description?: string;
};

export type AgentEvent =
  | (AgentEventBase & { kind: "phase_started"; phase: string })
  | (AgentEventBase & { kind: "phase_ended"; phase: string; status: "succeeded" | "failed" | "cancelled" })
  | (AgentEventBase & { kind: "message_delta"; text: string })
  | (AgentEventBase & { kind: "tool_call"; tool: string; input: unknown })
  | (AgentEventBase & { kind: "tool_result"; tool: string; ok: boolean })
  | (AgentEventBase & { kind: "log"; level: "info" | "warn" | "error"; text: string })
  // Brainstorm-specific events. Mirrored to <worktree>/.harness/<taskId>/brainstorm.jsonl.
  | (AgentEventBase & {
      kind: "brainstorm_question";
      questionId: string;
      prompt: string;
      options: BrainstormOption[];
      sectionTarget: { artifact: "design" | "spec"; section: string };
      /** When true, the user may pick multiple options (or one + freeText). */
      multiSelect?: boolean;
    })
  | (AgentEventBase & {
      kind: "brainstorm_answer";
      questionId: string;
      optionId?: string;
      /** Multi-select answer; co-exists with optionId for backwards compat. */
      optionIds?: string[];
      freeText?: string;
    })
  | (AgentEventBase & {
      kind: "brainstorm_system";
      systemKind: "probe_complete" | "self_critique_passed" | "status_changed";
      data?: Record<string, unknown>;
    })
  | (AgentEventBase & {
      kind: "brainstorm_revision_requested";
      comment: string;
    });
