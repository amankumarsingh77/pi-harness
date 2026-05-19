import { pgTable, text, timestamp, integer, jsonb, doublePrecision, uuid, index, serial } from "drizzle-orm/pg-core";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("backlog"),
    workflow: text("workflow"),
    worktreePath: text("worktree_path"),
    branchName: text("branch_name"),
    retryCount: integer("retry_count").notNull().default(0),
    priority: text("priority").notNull().default("none"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // Per-phase model overrides. Empty {} means "use DEFAULT_PHASE_MODELS".
    // Frozen after the first run row exists for this task (enforced at API).
    phaseModels: jsonb("phase_models").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("tasks_status_idx").on(t.status),
  }),
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    error: text("error"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    // Absolute path to <worktree>/.harness/<taskId>/pi-session.jsonl. Set on
    // the brainstorm Run row's first dispatch so subsequent ticks resume the
    // pi-coding-agent SessionManager from the same file across orchestrator
    // restarts. Null for runs that don't use a resumable agent session.
    piSessionPath: text("pi_session_path"),
  },
  (t) => ({
    taskIdx: index("runs_task_idx").on(t.taskId),
  }),
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
  },
  (t) => ({
    runIdx: index("events_run_idx").on(t.runId),
    tsIdx: index("events_ts_idx").on(t.ts),
  }),
);

export const liveEvents = pgTable(
  "live_events",
  {
    sequence: serial("sequence").primaryKey(),
    id: uuid("id").defaultRandom().notNull().unique(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    kind: text("kind").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull(),
  },
  (t) => ({
    taskSequenceIdx: index("live_events_task_sequence_idx").on(t.taskId, t.sequence),
    runSequenceIdx: index("live_events_run_sequence_idx").on(t.runId, t.sequence),
    scopeSequenceIdx: index("live_events_scope_sequence_idx").on(t.scope, t.sequence),
  }),
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    path: text("path").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index("artifacts_task_idx").on(t.taskId),
  }),
);
