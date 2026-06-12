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

export type BrainstormMockPage = {
  pageId: string;
  title: string;
  summary?: string;
  htmlPath: string;
  /** Rendered screenshots (Task 8 populates these). */
  desktopPngPath?: string;
  mobilePngPath?: string;
};

export type BrainstormMockMiniature =
  | {
      kind: "rows";
      rows: ReadonlyArray<{
        status: "pass" | "fail" | "muted";
        label: string;
        sub?: string;
        action?: string;
      }>;
    }
  | {
      kind: "grid+drawer";
      cells: ReadonlyArray<{ status: "pass" | "fail" }>;
      drawerTitle: string;
      diffLines: ReadonlyArray<{ kind: "plus" | "minus" }>;
      confirm: string;
    };

export type BrainstormMock = {
  mockId: string;
  title: string;
  summary: string;
  recommended: boolean;
  createdAt: string;
  derivedFrom?: string;
  evidence?: string[];
  contextSummary?: string;
  miniature?: BrainstormMockMiniature;
  pages: BrainstormMockPage[];
};

export type BrainstormMockManifest = {
  mocks: BrainstormMock[];
  selectedMockId: string | null;
};

export type AgentEvent =
  | (AgentEventBase & { kind: "phase_started"; phase: string })
  | (AgentEventBase & { kind: "phase_ended"; phase: string; status: "succeeded" | "failed" | "cancelled" })
  // `subagent` is set when the event originated inside a research subagent's
  // pi session (plan-phase preflight). Absent for events emitted by the
  // primary phase agent (the planner itself, brainstorm, etc.). The dashboard
  // routes drawer rendering off this field.
  | (AgentEventBase & { kind: "message_delta"; text: string; subagent?: string })
  | (AgentEventBase & { kind: "tool_call"; callId?: string; tool: string; input: unknown; subagent?: string })
  | (AgentEventBase & { kind: "tool_result"; callId?: string; tool: string; ok: boolean; output?: unknown; subagent?: string })
  | (AgentEventBase & { kind: "log"; level: "info" | "warn" | "error"; text: string; subagent?: string })
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
      artifactRevisionId?: string;
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
    })
  | (AgentEventBase & {
      kind: "brainstorm_mock_proposed";
      mockSetId?: string;
      mock: BrainstormMock;
    })
  | (AgentEventBase & {
      kind: "brainstorm_mock_revised";
      mockSetId?: string;
      mock: BrainstormMock;
      editRequestId: string;
    })
  | (AgentEventBase & {
      kind: "brainstorm_mock_selected";
      mockId: string;
    })
  | (AgentEventBase & {
      kind: "brainstorm_mock_edit_requested";
      requestId: string;
      mockId: string;
      comment: string;
    })
  | (AgentEventBase & {
      kind: "brainstorm_design_promoted";
      exemplarId: string;
      tokenVersion: number;
      summary: string;
    })
  // Plan-phase events. Mirrored to <worktree>/.harness/<taskId>/plan.jsonl.
  // The plan phase is driven by one parent planner that can spawn child
  // agents. Older preflight_* events remain supported for archived runs.
  | (AgentEventBase & {
      kind: "plan_system";
      systemKind:
        | "preflight_started"
        | "preflight_complete"
        | "planner_started"
        | "planner_turn_completed"
        | "status_changed"
        | "blocked"
        | "session_reset";
      data?: Record<string, unknown>;
    })
  // Lifecycle of a single research subagent in the preflight fan-out. One
  // started + one ended event per subagent per attempt. `sessionId` lets the
  // dashboard thread per-subagent message_delta / tool_call events even though
  // the underlying EventStore subscription is shared with the planner.
  | (AgentEventBase & {
      kind: "plan_subagent_started";
      subagent: string;
      sessionId: string;
      attemptId?: string;
    })
  | (AgentEventBase & {
      kind: "plan_subagent_ended";
      subagent: string;
      sessionId: string;
      attemptId?: string;
      ok: boolean;
      durationMs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      error?: string;
    })
  | (AgentEventBase & {
      kind: "plan_agent_node_started";
      nodeId: string;
      parentId: string | null;
      role: string;
      title: string;
      lane: string;
      sessionId: string;
      model: string;
      tools: readonly string[];
      prompt?: string;
      artifactPath: string | null;
      dependsOn: readonly string[];
    })
  | (AgentEventBase & {
      kind: "plan_agent_node_findings";
      nodeId: string;
      body: string;
    })
  | (AgentEventBase & {
      kind: "plan_agent_node_usage";
      nodeId: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    })
  | (AgentEventBase & {
      kind: "plan_agent_node_ended";
      nodeId: string;
      ok: boolean;
      status: "succeeded" | "failed" | "blocked" | "cancelled";
      durationMs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      error?: string;
    })
  | (AgentEventBase & {
      kind: "plan_revision_requested";
      comment: string;
    })
  | (AgentEventBase & {
      kind: "plan_usage";
      tickIndex: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      cumulativeInputTokens: number;
      cumulativeOutputTokens: number;
      cumulativeCostUsd: number;
    })
  | (AgentEventBase & {
      kind: "plan_artifact_edited";
      artifact: "plan" | "scenarios";
      commitSha: string;
      artifactRevisionId?: string;
      sizeDelta: number;
    })
  // Code-phase DAG execution events. The code runner emits one start/end pair
  // per execution-dag node and one cumulative usage event after the phase
  // settles so dashboard logs can replay scheduler progress.
  | (AgentEventBase & {
      kind: "code_node_started";
      nodeId: string;
      title: string;
      phaseName: string;
      lane: string;
      safety: "parallel-safe" | "exclusive";
      sessionId: string;
    })
  | (AgentEventBase & {
      kind: "code_node_ended";
      nodeId: string;
      ok: boolean;
      status: "succeeded" | "failed" | "blocked";
      durationMs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      commitSha?: string;
      error?: string;
    })
  | (AgentEventBase & {
      kind: "code_usage";
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    });
