import type { Task, Run, AgentEvent, Workflow, Artifact } from "@pi-harness/shared";

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

export type Api = {
  listTasks: () => Promise<{ tasks: Task[]; counts: Record<string, number> }>;
  getTask: (id: string) => Promise<{ task: Task; runs: Run[] }>;
  listRunFiles: (runId: string) => Promise<{ files: RunFile[] }>;
  createTask: (input: { title: string; description?: string }) => Promise<Task>;
  transitionTask: (
    id: string,
    action:
      | { type: "user_start_brainstorm"; workflow: Workflow }
      | { type: "user_approve_brainstorm" }
      | { type: "user_request_brainstorm_changes"; comment: string }
      | { type: "user_approve_plan" }
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
  ) => Promise<{ ok: true; archivedRunId: string; newRunId: string }>;
  getBrainstormDiff: (
    taskId: string,
    kind: "design" | "spec",
  ) => Promise<BrainstormDiff>;
  submitArtifactEdit: (
    taskId: string,
    payload: { kind: "design" | "spec"; body: string },
  ) => Promise<{ ok: true; commitSha: string }>;
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
      const r = await send<{ tasks: Task[]; counts: Record<string, number> }>("/api/tasks");
      return { tasks: r.tasks.map(hydrateTask), counts: r.counts };
    },
    getTask: async (id) => {
      const r = await send<{ task: Task; runs: Run[] }>(`/api/tasks/${id}`);
      return { task: hydrateTask(r.task), runs: r.runs.map(hydrateRun) };
    },
    createTask: async (input) =>
      hydrateTask(
        await send<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
      ),
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
      send<{ ok: true; archivedRunId: string; newRunId: string }>(
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
  };
}

// Postgres → Fastify → JSON serializes Date as ISO string. The shared types
// declare Date, so callers (kanban card, etc.) get a Date back.
function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}

function hydrateTask(t: Task): Task {
  return { ...t, createdAt: toDate(t.createdAt), updatedAt: toDate(t.updatedAt) };
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
