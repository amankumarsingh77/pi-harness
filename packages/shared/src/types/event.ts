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
  | (AgentEventBase & { kind: "tool_result"; tool: string; ok: boolean; output?: unknown })
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
      /**
       * Identifier shared by every question emitted in the same
       * `submit_questions` tool call. The dashboard renders all questions
       * with the same batchId as one composite card with a single Submit
       * button — partial answers are not allowed. The orchestrator does not
       * use this field; it is purely a UI grouping signal.
       */
      batchId: string;
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
      systemKind:
        | "probe_complete"
        | "self_critique_passed"
        | "status_changed"
        | "blocked"
        | "session_reset";
      data?: Record<string, unknown>;
    })
  | (AgentEventBase & {
      kind: "brainstorm_revision_requested";
      comment: string;
    })
  // Free-form user input injected mid-brainstorm. The agent's next tick reads
  // unconsumed nudges from JSONL and folds them into the prompt addendum;
  // after consumption it republishes the same nudgeId with consumed:true so
  // re-reads of the JSONL don't fold the same nudge twice.
  | (AgentEventBase & {
      kind: "brainstorm_user_nudge";
      nudgeId: string;
      comment: string;
      consumed: boolean;
    })
  // Per-tick usage breakdown emitted at the end of every brainstorm turn that
  // actually called the LLM. The single-tick fields support per-tick hover
  // breakdowns; cumulative fields are what the cost strip renders. Cumulative
  // values survive orchestrator restarts via the JSONL replay in runBrainstorm.
  | (AgentEventBase & {
      kind: "brainstorm_usage";
      tickIndex: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      cumulativeInputTokens: number;
      cumulativeOutputTokens: number;
      cumulativeCostUsd: number;
    })
  // User-authored direct edit to design.md / spec.md via the dashboard's
  // edit-in-place affordance. Pure transcript signal — the artifact itself
  // is on disk + committed to the worktree branch by the route handler.
  | (AgentEventBase & {
      kind: "brainstorm_artifact_edited";
      artifact: "design" | "spec";
      commitSha: string;
      sizeDelta: number;
    })
  // Free-form prose reply from the agent, surfaced in the brainstorm
  // transcript as a chat bubble. Emitted by the `reply_to_user` custom tool
  // — the only user-facing prose channel for the brainstorm phase.
  // `message_delta` events stream to the Agent Log on the task detail page
  // but do not render in the brainstorm transcript; this event kind is
  // explicitly for replies the agent wants the user to read.
  // `inReplyToNudgeId` is optional but recommended — when set, the dashboard
  // pairs the reply visually with the nudge it's answering.
  | (AgentEventBase & {
      kind: "brainstorm_agent_reply";
      replyId: string;
      message: string;
      inReplyToNudgeId?: string;
    });
