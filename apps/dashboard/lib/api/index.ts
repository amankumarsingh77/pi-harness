import type {
  DashboardSummary,
  Phase,
  PhaseModelConfig,
  Task,
  Run,
  AgentEvent,
  Workflow,
  Artifact,
  BrainstormMock,
  BrainstormMockManifest,
  Claim,
  ClaimEvent,
  MissionEvent,
  MissionPacket,
  PreflightStep,
  ChatThread,
  ChatMessage,
  ChatModelSelection,
} from "@pi-harness/shared";

// "awaiting_user" exactly when the artifacts on disk are status: ready AND
// no brainstorm_revision_requested event has been filed since the last
// status_changed → ready event. Server-derived per request — there is no
// stored boolean for the gate. Mirrors the orchestrator's BrainstormGate.
export type BrainstormGate = "running" | "awaiting_user";

export type BrainstormBundle = {
  gate: BrainstormGate;
  status: Task["status"];
  design: Artifact | null;
  spec: Artifact | null;
  events: BrainstormJsonlEvent[];
};

export type BrainstormMockBundle = BrainstormMockManifest;

// Plan-phase counterpart to BrainstormBundle. Same gate semantics; research
// is keyed by subagent name (one of the 5 preflight + claim-verifier).
export type PlanGate = "running" | "awaiting_user";

export type PlanBundle = {
  gate: PlanGate;
  status: Task["status"];
  plan: Artifact | null;
  phasePlans: Artifact[];
  scenarios: Artifact | null;
  blastRadius: Artifact | null;
  executionDag: Artifact | null;
  research: Record<string, string | null>;
  preflightSteps: PreflightStep[];
  preflightBlockedReason: string | null;
  events: PlanJsonlEvent[];
  // Most recent unresolved `plan_system blocked` event — the reason the plan
  // phase stalled. Null when no block is in effect (the plan is healthy, or a
  // later ready/session_reset cleared the prior block).
  lastBlocked: { reason: string; ts: string } | null;
};

export type PlanJsonlEvent =
  | {
      kind: "plan_system";
      ts: string;
      systemKind:
        | "preflight_started"
        | "preflight_complete"
        | "planner_started"
        | "planner_turn_completed"
        | "status_changed"
        | "blocked"
        | "session_reset";
      data?: Record<string, unknown>;
    }
  | {
      kind: "plan_subagent_started";
      ts: string;
      subagent: string;
      sessionId: string;
      attemptId?: string;
    }
  | {
      kind: "plan_subagent_ended";
      ts: string;
      subagent: string;
      sessionId: string;
      attemptId?: string;
      ok: boolean;
      durationMs: number;
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      error?: string;
    }
  | { kind: "plan_revision_requested"; ts: string; comment: string }
  | {
      kind: "plan_usage";
      ts: string;
      tickIndex: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      cumulativeInputTokens: number;
      cumulativeOutputTokens: number;
      cumulativeCostUsd: number;
    }
  | {
      kind: "plan_artifact_edited";
      ts: string;
      artifact: "plan" | "scenarios";
      commitSha: string;
      sizeDelta: number;
    };

export type PlanDiff = {
  kind: "plan";
  baseline: { commit: string; body: string } | null;
  current: { body: string } | null;
};

export type MissionBundle = {
  mission: MissionPacket;
  claims: Claim[];
  events: MissionEvent[];
  claimEvents: ClaimEvent[];
};

export type VerifierRunRequest = {
  readonly claimIds?: readonly string[];
  readonly mode?: "pending" | "all";
};

export type VerifierRunResult = {
  readonly ok: boolean;
  readonly taskId: string;
  readonly runId: string;
  readonly mode: "pending" | "all";
  readonly verified: readonly {
    readonly claimId: string;
    readonly sourceKey: string;
    readonly scenarioId: string;
    readonly status: "proven" | "challenged";
    readonly ok: boolean;
    readonly verifierNote: string;
  }[];
  readonly skipped: readonly {
    readonly claimId: string;
    readonly sourceKey: string;
    readonly reason: string;
  }[];
};

// JSONL events as written by the orchestrator (mirrors AgentEvent's
// brainstorm_* kinds, but tagged with `kind` directly — no AgentEventBase
// envelope on disk).
export type BrainstormJsonlEvent =
  | {
      kind: "brainstorm_question";
      ts: string;
      questionId: string;
      prompt: string;
      options: { id: string; label: string; recommended: boolean; evidence: string[]; description?: string }[];
      sectionTarget: { artifact: "design" | "spec"; section: string };
      multiSelect?: boolean;
      batchId: string;
    }
  | {
      kind: "brainstorm_answer";
      ts: string;
      questionId: string;
      optionId?: string;
      optionIds?: string[];
      freeText?: string;
    }
  | {
      kind: "brainstorm_system";
      ts: string;
      systemKind:
        | "probe_complete"
        | "self_critique_passed"
        | "status_changed"
        | "blocked"
        | "session_reset";
      data?: Record<string, unknown>;
    }
  | { kind: "brainstorm_revision_requested"; ts: string; comment: string }
  | {
      kind: "brainstorm_user_nudge";
      ts: string;
      nudgeId: string;
      comment: string;
      consumed: boolean;
    }
  | {
      kind: "brainstorm_usage";
      ts: string;
      tickIndex: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      cumulativeInputTokens: number;
      cumulativeOutputTokens: number;
      cumulativeCostUsd: number;
    }
  | {
      kind: "brainstorm_artifact_edited";
      ts: string;
      artifact: "design" | "spec";
      commitSha: string;
      sizeDelta: number;
    }
  | {
      kind: "brainstorm_agent_reply";
      ts: string;
      replyId: string;
      message: string;
      inReplyToNudgeId?: string;
    }
  | {
      kind: "brainstorm_mock_proposed";
      ts: string;
      mockSetId?: string;
      mock: BrainstormMock;
    }
  | {
      kind: "brainstorm_mock_revised";
      ts: string;
      mockSetId?: string;
      mock: BrainstormMock;
      editRequestId: string;
    }
  | {
      kind: "brainstorm_mock_selected";
      ts: string;
      mockId: string;
    }
  | {
      kind: "brainstorm_mock_edit_requested";
      ts: string;
      requestId: string;
      mockId: string;
      comment: string;
    };

// Preview of the design-token changes a mock promotion would write to the
// shared design system. `before`/`after` are the literal token values (a hex
// color, a font stack, a spacing scalar); `before: null` means the token is
// new, `after: null` means it would be removed. `designMdDelta` is the unified
// diff of design.md the promotion would apply.
export type TokenDiff = {
  fromVersion: number;
  toVersion: number;
  summary: string;
  changes: { name: string; before: string | null; after: string | null }[];
  designMdDelta: string;
};

// Full snapshot of the shared design system at /design: the raw tokens.css and
// design.md, plus the manifest of promoted exemplars and the promotion history.
export type DesignSystemSnapshot = {
  exists: boolean;
  tokensCss: string;
  designMd: string;
  manifest: {
    tokenVersion: number;
    updatedAt: string;
    exemplars: {
      id: string;
      title: string;
      png: string;
      promotedFromTask: string;
      promotedMockId: string;
      tokenVersion: number;
    }[];
    history: { tokenVersion: number; task: string; summary: string }[];
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type RunFile = {
  path: string;
  added: number;
  removed: number;
  state: "live" | "settled";
};

export type ChatThreadDetail = {
  thread: ChatThread;
  messages: ChatMessage[];
};

/**
 * A model in the provider catalog (serializable mirror of pi-bridge's
 * ProviderModel). The one shape used by both the chat picker and the new-task
 * stage selector.
 */
export type ProviderModel = {
  id: string;
  name: string;
  reasoning: boolean;
  /** Context window in tokens. */
  contextWindow: number;
  /** Max output tokens. */
  maxTokens: number;
  /** USD per 1M tokens. */
  cost: { input: number; output: number };
};

/** A provider + its models + auth method + whether a credential is configured. */
export type Provider = {
  id: string;
  name: string;
  authenticated: boolean;
  auth: "api-key" | "oauth";
  /** Env vars that supply the API key. `[]` for OAuth providers. */
  requiredEnvVars: readonly string[];
  models: ProviderModel[];
};

export type PostMessageResult = {
  userMessage: ChatMessage;
  assistantMessageId: string;
};

export type Api = {
  listTasks: () => Promise<TaskListResult>;
  getTask: (id: string) => Promise<{ task: Task; runs: Run[] }>;
  listRunFiles: (runId: string) => Promise<{ files: RunFile[] }>;
  createTask: (
    input: Pick<Task, "title"> &
      Partial<Pick<Task, "description" | "priority" | "tags">> & {
        phaseModels?: Partial<Record<Phase, Partial<PhaseModelConfig>>>;
      },
  ) => Promise<Task>;
  getProviders: () => Promise<{ providers: Provider[] }>;
  transitionTask: (
    id: string,
    action:
      | { type: "user_start_brainstorm"; workflow: Workflow }
      | { type: "user_approve_brainstorm" }
      | { type: "user_request_brainstorm_changes"; comment: string }
      | { type: "user_approve_plan" }
      | { type: "user_request_plan_changes"; comment: string }
      | { type: "user_cancel_current_phase" }
      | { type: "user_cancel" }
      | { type: "user_retry_failed" },
  ) => Promise<{ task: Task }>;
  listEvents: (runId: string) => Promise<{ events: AgentEvent[] }>;
  getArtifact: <T>(taskId: string, name: "brainstorm" | "plan" | "proof-report") => Promise<T>;
  getBrainstormBundle: (taskId: string) => Promise<BrainstormBundle>;
  submitBrainstormAnswers: (
    taskId: string,
    payload: {
      answers: {
        questionId: string;
        optionId?: string;
        optionIds?: string[];
        freeText?: string;
      }[];
    },
  ) => Promise<{ ok: true; count: number }>;
  submitBrainstormNudge: (
    taskId: string,
    payload: { comment: string },
  ) => Promise<{ ok: true; nudgeId: string }>;
  restartBrainstorm: (
    taskId: string,
    payload: { note?: string },
  ) => Promise<{ ok: true; archivedRunId: string | null; newRunId: string }>;
  getBrainstormDiff: (
    taskId: string,
    kind: "design" | "spec",
  ) => Promise<BrainstormDiff>;
  submitArtifactEdit: (
    taskId: string,
    payload: { kind: "design" | "spec"; body: string },
  ) => Promise<{ ok: true; commitSha: string }>;
  getBrainstormMocks: (taskId: string) => Promise<BrainstormMockBundle>;
  getBrainstormMockPageHtml: (
    taskId: string,
    mockId: string,
    pageId: string,
  ) => Promise<string>;
  submitBrainstormMockEdit: (
    taskId: string,
    mockId: string,
    payload: { comment: string },
  ) => Promise<{ ok: true; requestId: string }>;
  selectBrainstormMock: (
    taskId: string,
    mockId: string,
  ) => Promise<{ ok: true; mockId: string }>;
  promoteBrainstormMock: (taskId: string, mockId: string) => Promise<TokenDiff>;
  confirmPromoteBrainstormMock: (
    taskId: string,
    mockId: string,
    diff: TokenDiff,
  ) => Promise<{ ok: true; tokenVersion: number; exemplarId: string }>;
  getDesignSystem: () => Promise<DesignSystemSnapshot>;
  getPlanBundle: (taskId: string) => Promise<PlanBundle>;
  getMission: (taskId: string) => Promise<MissionBundle>;
  runVerifier: (taskId: string, payload?: VerifierRunRequest) => Promise<VerifierRunResult>;
  getPlanDiff: (taskId: string, kind: "plan") => Promise<PlanDiff>;
  submitPlanArtifactEdit: (
    taskId: string,
    payload: { kind: "plan"; body: string },
  ) => Promise<{ ok: true; commitSha: string }>;
  restartPlan: (
    taskId: string,
    payload: { note?: string },
  ) => Promise<{ ok: true; archivedRunId: string; newRunId: string }>;
  // ── Chat ──────────────────────────────────────────────────────────────────
  createChatThread: (
    input: { title?: string; model?: ChatModelSelection },
  ) => Promise<ChatThread>;
  listChatThreads: () => Promise<{ threads: ChatThread[] }>;
  getChatThread: (threadId: string) => Promise<ChatThreadDetail>;
  postChatMessage: (threadId: string, payload: { text: string }) => Promise<PostMessageResult>;
  updateChatModel: (threadId: string, model: ChatModelSelection) => Promise<ChatThread>;
  stopChatTurn: (threadId: string) => Promise<{ stopped: boolean }>;
};

export type TaskListResult = {
  readonly tasks: Task[];
  readonly counts: Record<string, number>;
  readonly humanInterventionTaskIds: readonly string[];
  readonly summary: DashboardSummary;
};

export type BrainstormDiff = {
  kind: "design" | "spec";
  baseline: { commit: string; body: string } | null;
  current: { body: string } | null;
};

export function api(opts: { baseUrl: string; fetch?: Fetch }): Api {
  const f: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const url = (path: string) => `${opts.baseUrl}${path}`;

  async function send<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await f(url(path), {
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ApiError(res.status, body.message ?? res.statusText, body.error);
    }
    return (await res.json()) as T;
  }

  return {
    listTasks: async () => {
      const r = await send<TaskListResult>("/api/tasks");
      return {
        tasks: r.tasks.map(hydrateTask),
        counts: r.counts,
        humanInterventionTaskIds: r.humanInterventionTaskIds,
        summary: hydrateDashboardSummary(r.summary),
      };
    },
    getTask: async (id) => {
      const r = await send<{ task: Task; runs: Run[] }>(`/api/tasks/${id}`);
      return { task: hydrateTask(r.task), runs: r.runs.map(hydrateRun) };
    },
    createTask: async (input) =>
      hydrateTask(
        await send<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
      ),
    getProviders: () => send<{ providers: Provider[] }>("/api/providers"),
    transitionTask: async (id, action) => {
      const r = await send<{ task: Task }>(`/api/tasks/${id}/transitions`, {
        method: "POST",
        body: JSON.stringify(action),
      });
      return { task: hydrateTask(r.task) };
    },
    listEvents: async (runId) => {
      const r = await send<{ events: AgentEvent[] }>(`/api/runs/${runId}/events`);
      return { events: r.events.map(hydrateEvent) };
    },
    listRunFiles: (runId) => send<{ files: RunFile[] }>(`/api/runs/${runId}/files`),
    getArtifact: (taskId, name) => send(`/api/tasks/${taskId}/artifacts/${name}`),
    getBrainstormBundle: (taskId) => send<BrainstormBundle>(`/api/tasks/${taskId}/brainstorm`),
    submitBrainstormAnswers: (taskId, payload) =>
      send<{ ok: true; count: number }>(`/api/tasks/${taskId}/brainstorm/answers`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    submitBrainstormNudge: (taskId, payload) =>
      send<{ ok: true; nudgeId: string }>(`/api/tasks/${taskId}/brainstorm/nudge`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    restartBrainstorm: (taskId, payload) =>
      send<{ ok: true; archivedRunId: string | null; newRunId: string }>(
        `/api/tasks/${taskId}/brainstorm/restart`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    getBrainstormDiff: (taskId, kind) =>
      send<BrainstormDiff>(`/api/tasks/${taskId}/brainstorm/diff?kind=${kind}`),
    submitArtifactEdit: (taskId, payload) =>
      send<{ ok: true; commitSha: string }>(
        `/api/tasks/${taskId}/brainstorm/artifact`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    getBrainstormMocks: (taskId) =>
      send<BrainstormMockBundle>(`/api/tasks/${taskId}/brainstorm/mocks`),
    getBrainstormMockPageHtml: async (taskId, mockId, pageId) => {
      const res = await f(
        url(`/api/tasks/${taskId}/brainstorm/mocks/${mockId}/pages/${pageId}/html`),
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new ApiError(res.status, body.message ?? res.statusText, body.error);
      }
      return res.text();
    },
    submitBrainstormMockEdit: (taskId, mockId, payload) =>
      send<{ ok: true; requestId: string }>(
        `/api/tasks/${taskId}/brainstorm/mocks/${mockId}/edit`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    selectBrainstormMock: (taskId, mockId) =>
      send<{ ok: true; mockId: string }>(
        `/api/tasks/${taskId}/brainstorm/mocks/${mockId}/select`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    promoteBrainstormMock: (taskId, mockId) =>
      send<TokenDiff>(
        `/api/tasks/${taskId}/brainstorm/mocks/${mockId}/promote`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    confirmPromoteBrainstormMock: (taskId, mockId, diff) =>
      send<{ ok: true; tokenVersion: number; exemplarId: string }>(
        `/api/tasks/${taskId}/brainstorm/mocks/${mockId}/promote/confirm`,
        {
          method: "POST",
          body: JSON.stringify(diff),
        },
      ),
    getDesignSystem: () => send<DesignSystemSnapshot>(`/api/design`),
    getPlanBundle: (taskId) => send<PlanBundle>(`/api/tasks/${taskId}/plan`),
    getMission: (taskId) => send<MissionBundle>(`/api/tasks/${taskId}/mission`),
    runVerifier: (taskId, payload = {}) =>
      send<VerifierRunResult>(`/api/tasks/${taskId}/verifier/run`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    getPlanDiff: (taskId, kind) =>
      send<PlanDiff>(`/api/tasks/${taskId}/plan/diff?kind=${kind}`),
    submitPlanArtifactEdit: (taskId, payload) =>
      send<{ ok: true; commitSha: string }>(
        `/api/tasks/${taskId}/plan/artifact`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    restartPlan: (taskId, payload) =>
      send<{ ok: true; archivedRunId: string; newRunId: string }>(
        `/api/tasks/${taskId}/plan/restart`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    // ── Chat ──────────────────────────────────────────────────────────────────
    createChatThread: async (input) => {
      const r = await send<ChatThread>("/api/chat/threads", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return hydrateChatThread(r);
    },
    listChatThreads: async () => {
      const r = await send<{ threads: ChatThread[] }>("/api/chat/threads");
      return { threads: r.threads.map(hydrateChatThread) };
    },
    getChatThread: async (threadId) => {
      const r = await send<ChatThreadDetail>(`/api/chat/threads/${threadId}`);
      return {
        thread: hydrateChatThread(r.thread),
        messages: r.messages.map(hydrateChatMessage),
      };
    },
    postChatMessage: async (threadId, payload) => {
      const r = await send<PostMessageResult>(
        `/api/chat/threads/${threadId}/messages`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      return {
        userMessage: hydrateChatMessage(r.userMessage),
        assistantMessageId: r.assistantMessageId,
      };
    },
    updateChatModel: async (threadId, model) => {
      const r = await send<ChatThread>(
        `/api/chat/threads/${threadId}/model`,
        { method: "PATCH", body: JSON.stringify(model) },
      );
      return hydrateChatThread(r);
    },
    stopChatTurn: (threadId) =>
      send<{ stopped: boolean }>(`/api/chat/threads/${threadId}/stop`, {
        method: "POST",
      }),
  };
}

// Fastify JSON serializes Date as ISO string. The shared types declare Date,
// so callers (kanban card, etc.) get a Date back.
function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}

function hydrateTask(t: Task): Task {
  return {
    ...t,
    priority: t.priority ?? "none",
    tags: t.tags ?? [],
    createdAt: toDate(t.createdAt),
    updatedAt: toDate(t.updatedAt),
  };
}

function hydrateRun(r: Run): Run {
  return {
    ...r,
    startedAt: toDate(r.startedAt),
    endedAt: r.endedAt ? toDate(r.endedAt) : null,
  };
}

function hydrateEvent(e: AgentEvent): AgentEvent {
  return { ...e, ts: toDate(e.ts) };
}

function hydrateDashboardSummary(summary: DashboardSummary): DashboardSummary {
  return {
    ...summary,
    lastEventAt: summary.lastEventAt ? toDate(summary.lastEventAt) : null,
  };
}

function hydrateChatThread(t: ChatThread): ChatThread {
  return {
    ...t,
    createdAt: toDate(t.createdAt),
    updatedAt: toDate(t.updatedAt),
  };
}

function hydrateChatMessage(m: ChatMessage): ChatMessage {
  return {
    ...m,
    createdAt: toDate(m.createdAt),
  };
}
