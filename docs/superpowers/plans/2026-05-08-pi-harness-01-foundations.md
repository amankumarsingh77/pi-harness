# pi-harness Plan 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the substrate every other v1 plan depends on — pnpm/turbo monorepo, shared types, Postgres schema, a thin pi-bridge wrapper around `@earendil-works/pi-coding-agent` + `pi-subagents`, and the vendored subagent fleet from rpiv-mono.

**Architecture:** Monorepo with `apps/` (dashboard, orchestrator) and `packages/` (shared, pi-bridge). Postgres holds task/run/event state via Drizzle. The pi-bridge package is the *only* place that imports pi SDKs — the rest of the codebase talks to a stable internal API. Vendored subagent prompts live as `.md` files under `subagents/_vendored/` (rpiv) and `subagents/ours/` (new).

**Tech Stack:** TypeScript, Node 22+, pnpm workspaces, Turbo, Drizzle ORM, Postgres 16, Vitest, Zod, `@earendil-works/pi-coding-agent`, `pi-subagents`.

**Spec reference:** `docs/superpowers/specs/2026-05-08-pi-harness-design.md` (§2 reuse vs build, §9 agent fleet, §12 repo layout).

**Out of scope for this plan:** orchestrator state machine, agent prompts beyond vendoring, dashboard UI, worktree manager. Those land in Plans 2–4.

---

## File Structure

This plan creates these files:

| Path | Responsibility |
|---|---|
| `package.json` | Monorepo root, pnpm workspaces, turbo scripts |
| `pnpm-workspace.yaml` | Workspace globs |
| `turbo.json` | Build/test/lint pipeline |
| `tsconfig.base.json` | Shared TS config |
| `.gitignore` | Node, build, `.harness/` runtime dir |
| `.nvmrc` | Pin Node 22 |
| `vitest.config.ts` | Shared test config |
| `packages/shared/package.json` | Shared types package manifest |
| `packages/shared/src/types/task.ts` | `Task`, `TaskStatus`, `Workflow` types |
| `packages/shared/src/types/run.ts` | `Run`, `Phase`, `PhaseStatus` types |
| `packages/shared/src/types/event.ts` | `AgentEvent` discriminated union |
| `packages/shared/src/types/scenario.ts` | `Scenario` types (api / ui / ui-visual) |
| `packages/shared/src/schemas/scenario.ts` | Zod schema for `verification.yaml` |
| `packages/shared/src/index.ts` | Barrel export |
| `packages/shared/test/scenario-schema.test.ts` | Zod parse tests |
| `packages/db/package.json` | Drizzle + pg manifest |
| `packages/db/src/schema.ts` | Drizzle table definitions |
| `packages/db/src/client.ts` | Pool + `db` exports |
| `packages/db/drizzle.config.ts` | Drizzle Kit config |
| `packages/db/migrations/0000_initial.sql` | First migration (generated) |
| `packages/db/test/schema.test.ts` | Round-trip insert/select test |
| `packages/pi-bridge/package.json` | pi SDK wrapper manifest |
| `packages/pi-bridge/src/types.ts` | `PiSession`, `PiSubagentSpec`, `PiResult` types |
| `packages/pi-bridge/src/session.ts` | `createSession()` factory |
| `packages/pi-bridge/src/subagent.ts` | `runSubagent()` wrapper |
| `packages/pi-bridge/src/index.ts` | Barrel export |
| `packages/pi-bridge/test/session.test.ts` | Mocked pi session test |
| `subagents/_vendored/` | 13 rpiv-mono `.md` agents copied verbatim |
| `subagents/ATTRIBUTION.md` | License/attribution for vendored agents |
| `subagents/index.ts` | Loader that maps agent name → file path |
| `subagents/test/loader.test.ts` | Verifies all expected agents resolve |
| `docker-compose.yml` | Local Postgres for dev/test |
| `.env.example` | `DATABASE_URL`, `PI_AGENT_PATH` |
| `README.md` | One-pager: setup, dev loop |

---

## Task 1: Initialize monorepo root

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `.env.example`, `README.md`

- [ ] **Step 1: Create `.nvmrc`**

`.nvmrc`:
```
22
```

- [ ] **Step 2: Create `.gitignore`**

`.gitignore`:
```
node_modules
dist
.turbo
*.log
.env
.env.local
.harness/
coverage
```

- [ ] **Step 3: Create `package.json`**

`package.json`:
```json
{
  "name": "pi-harness",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:migrate": "pnpm --filter @pi-harness/db migrate",
    "db:generate": "pnpm --filter @pi-harness/db generate"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 5: Create `turbo.json`**

`turbo.json`:
```json
{
  "$schema": "https://turborepo.org/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 6: Create `tsconfig.base.json`**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 7: Create `.env.example`**

`.env.example`:
```
DATABASE_URL=postgresql://piharness:piharness@localhost:5433/piharness
PI_AGENT_PATH=/usr/local/bin/pi
```

- [ ] **Step 8: Create `README.md`**

`README.md`:
```markdown
# pi-harness

Multi-agent coding harness built on pi.dev. See `docs/superpowers/specs/2026-05-08-pi-harness-design.md`.

## Setup

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
```

## Dev loop

```bash
pnpm test       # all packages
pnpm typecheck  # all packages
pnpm build      # all packages
```
```

- [ ] **Step 9: Install root deps**

Run: `corepack enable && pnpm install`
Expected: lockfile created, no errors.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .gitignore .nvmrc .env.example README.md
git commit -m "chore: initialize pnpm + turbo monorepo"
```

---

## Task 2: Add docker-compose for Postgres

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `docker-compose.yml`**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: pi-harness-postgres
    environment:
      POSTGRES_USER: piharness
      POSTGRES_PASSWORD: piharness
      POSTGRES_DB: piharness
    ports:
      - "5433:5432"
    volumes:
      - pi-harness-pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U piharness"]
      interval: 2s
      timeout: 2s
      retries: 10

volumes:
  pi-harness-pg:
```

- [ ] **Step 2: Start Postgres**

Run: `pnpm db:up`
Expected: container starts; `docker ps` shows `pi-harness-postgres` healthy after ~5s.

- [ ] **Step 3: Verify connection**

Run: `psql postgresql://piharness:piharness@localhost:5433/piharness -c 'select 1;'`
Expected: `1` returned.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add postgres docker-compose for local dev"
```

---

## Task 3: Create `@pi-harness/shared` package — types

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/types/task.ts`, `packages/shared/src/types/run.ts`, `packages/shared/src/types/event.ts`, `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

`packages/shared/package.json`:
```json
{
  "name": "@pi-harness/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint configured'"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `src/types/task.ts`**

`packages/shared/src/types/task.ts`:
```typescript
export const TASK_STATUSES = [
  "backlog",
  "brainstorming",
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const WORKFLOWS = ["backend-feature"] as const;
export type Workflow = (typeof WORKFLOWS)[number];

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  workflow: Workflow | null;
  worktreePath: string | null;
  branchName: string | null;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 4: Create `src/types/run.ts`**

`packages/shared/src/types/run.ts`:
```typescript
export const PHASES = [
  "brainstorm",
  "plan",
  "code",
  "verify",
  "pr",
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export type Run = {
  id: string;
  taskId: string;
  phase: Phase;
  status: PhaseStatus;
  startedAt: Date;
  endedAt: Date | null;
  error: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};
```

- [ ] **Step 5: Create `src/types/event.ts`**

`packages/shared/src/types/event.ts`:
```typescript
export type AgentEventBase = {
  id: string;
  runId: string;
  taskId: string;
  ts: Date;
};

export type AgentEvent =
  | (AgentEventBase & { kind: "phase_started"; phase: string })
  | (AgentEventBase & { kind: "phase_ended"; phase: string; status: "succeeded" | "failed" | "cancelled" })
  | (AgentEventBase & { kind: "message_delta"; text: string })
  | (AgentEventBase & { kind: "tool_call"; tool: string; input: unknown })
  | (AgentEventBase & { kind: "tool_result"; tool: string; ok: boolean })
  | (AgentEventBase & { kind: "log"; level: "info" | "warn" | "error"; text: string });
```

- [ ] **Step 6: Create barrel `src/index.ts`**

`packages/shared/src/index.ts`:
```typescript
export * from "./types/task.js";
export * from "./types/run.js";
export * from "./types/event.js";
```

- [ ] **Step 7: Install deps & build**

Run: `pnpm install && pnpm --filter @pi-harness/shared build`
Expected: `dist/index.js` and `dist/index.d.ts` exist.

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add Task / Run / AgentEvent types"
```

---

## Task 4: Add Scenario types + Zod schema with tests

**Files:**
- Create: `packages/shared/src/types/scenario.ts`, `packages/shared/src/schemas/scenario.ts`, `packages/shared/test/scenario-schema.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test**

`packages/shared/test/scenario-schema.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ScenarioFileSchema } from "../src/schemas/scenario.js";

describe("ScenarioFileSchema", () => {
  it("parses a valid api scenario", () => {
    const input = {
      scenarios: [
        {
          id: "api-1",
          type: "api",
          name: "GET /health returns 200",
          request: { method: "GET", url: "http://localhost:3000/health" },
          expect: { status: 200 },
        },
      ],
    };
    const parsed = ScenarioFileSchema.parse(input);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0]!.type).toBe("api");
  });

  it("parses a valid ui scenario", () => {
    const input = {
      scenarios: [
        {
          id: "ui-1",
          type: "ui",
          name: "login redirects",
          steps: [{ navigate: "http://localhost:3000/login" }],
          expect: { url_matches: "**/dashboard", screenshot: "ok.png" },
        },
      ],
    };
    expect(() => ScenarioFileSchema.parse(input)).not.toThrow();
  });

  it("rejects an unknown scenario type", () => {
    const input = { scenarios: [{ id: "x", type: "telepathy", name: "n" }] };
    expect(() => ScenarioFileSchema.parse(input)).toThrow();
  });

  it("rejects duplicate scenario ids", () => {
    const input = {
      scenarios: [
        { id: "dup", type: "api", name: "a", request: { method: "GET", url: "x" }, expect: { status: 200 } },
        { id: "dup", type: "api", name: "b", request: { method: "GET", url: "x" }, expect: { status: 200 } },
      ],
    };
    expect(() => ScenarioFileSchema.parse(input)).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @pi-harness/shared test`
Expected: FAIL — `ScenarioFileSchema` not found.

- [ ] **Step 3: Implement `src/types/scenario.ts`**

`packages/shared/src/types/scenario.ts`:
```typescript
export type ApiScenario = {
  id: string;
  type: "api";
  name: string;
  setup?: { bash: string }[];
  request: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  expect: { status: number; body_contains?: string[] };
};

export type UiStep =
  | { navigate: string }
  | { fill: { selector: string; value: string } }
  | { click: string }
  | { wait_for_url: string };

export type UiScenario = {
  id: string;
  type: "ui";
  name: string;
  setup?: { bash: string }[];
  steps: UiStep[];
  expect: { url_matches?: string; screenshot?: string };
};

export type UiVisualScenario = {
  id: string;
  type: "ui-visual";
  name: string;
  steps: UiStep[];
  capture: { selector?: string; full_page?: boolean; filename: string };
};

export type Scenario = ApiScenario | UiScenario | UiVisualScenario;

export type ScenarioFile = { scenarios: Scenario[] };
```

- [ ] **Step 4: Implement `src/schemas/scenario.ts`**

`packages/shared/src/schemas/scenario.ts`:
```typescript
import { z } from "zod";

const SetupSchema = z.array(z.object({ bash: z.string() })).optional();

const ApiScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.literal("api"),
  name: z.string().min(1),
  setup: SetupSchema,
  request: z.object({
    method: z.string(),
    url: z.string().url().or(z.string().startsWith("http")),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  }),
  expect: z.object({
    status: z.number().int().min(100).max(599),
    body_contains: z.array(z.string()).optional(),
  }),
});

const UiStepSchema = z.union([
  z.object({ navigate: z.string() }),
  z.object({ fill: z.object({ selector: z.string(), value: z.string() }) }),
  z.object({ click: z.string() }),
  z.object({ wait_for_url: z.string() }),
]);

const UiScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.literal("ui"),
  name: z.string().min(1),
  setup: SetupSchema,
  steps: z.array(UiStepSchema).min(1),
  expect: z.object({
    url_matches: z.string().optional(),
    screenshot: z.string().optional(),
  }),
});

const UiVisualScenarioSchema = z.object({
  id: z.string().min(1),
  type: z.literal("ui-visual"),
  name: z.string().min(1),
  steps: z.array(UiStepSchema).min(1),
  capture: z.object({
    selector: z.string().optional(),
    full_page: z.boolean().optional(),
    filename: z.string().min(1),
  }),
});

export const ScenarioSchema = z.discriminatedUnion("type", [
  ApiScenarioSchema,
  UiScenarioSchema,
  UiVisualScenarioSchema,
]);

export const ScenarioFileSchema = z
  .object({ scenarios: z.array(ScenarioSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const s of file.scenarios) {
      if (seen.has(s.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate scenario id: ${s.id}`, path: ["scenarios"] });
      }
      seen.add(s.id);
    }
  });
```

- [ ] **Step 5: Update barrel**

Replace `packages/shared/src/index.ts`:
```typescript
export * from "./types/task.js";
export * from "./types/run.js";
export * from "./types/event.js";
export * from "./types/scenario.js";
export * from "./schemas/scenario.js";
```

- [ ] **Step 6: Run test, verify it passes**

Run: `pnpm --filter @pi-harness/shared test`
Expected: PASS — 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add Scenario types and Zod schema with duplicate-id check"
```

---

## Task 5: Create `@pi-harness/db` package — Drizzle schema

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/index.ts`

- [x] **Step 1: Create `packages/db/package.json`**

`packages/db/package.json`:
```json
{
  "name": "@pi-harness/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint configured'",
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@pi-harness/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [x] **Step 2: Create `packages/db/tsconfig.json`**

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [x] **Step 3: Create `src/schema.ts`**

`packages/db/src/schema.ts`:
```typescript
import { pgTable, text, timestamp, integer, jsonb, doublePrecision, uuid, index } from "drizzle-orm/pg-core";

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

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "brainstorm" | "plan" | "verification" | "proof_report"
    path: text("path").notNull(), // disk path under .harness/runs/<task>/
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    taskIdx: index("artifacts_task_idx").on(t.taskId),
  }),
);
```

- [x] **Step 4: Create `src/client.ts`**

`packages/db/src/client.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type DbClient = ReturnType<typeof createDb>["db"];
```

- [x] **Step 5: Create `src/index.ts`**

`packages/db/src/index.ts`:
```typescript
export * from "./schema.js";
export * from "./client.js";
```

- [x] **Step 6: Create `drizzle.config.ts`**

`packages/db/drizzle.config.ts`:
```typescript
import "dotenv/config";
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness",
  },
} satisfies Config;
```

- [x] **Step 7: Add `dotenv` to db deps**

Edit `packages/db/package.json` to add `"dotenv": "^16.4.0"` under `dependencies`.

- [x] **Step 8: Install + build**

Run: `pnpm install && pnpm --filter @pi-harness/db build`
Expected: clean build.

- [x] **Step 9: Generate initial migration**

Run: `pnpm --filter @pi-harness/db generate`
Expected: `packages/db/migrations/0000_*.sql` created with `CREATE TABLE tasks`, `runs`, `events`, `artifacts`.

- [x] **Step 10: Apply migration**

Run: `pnpm --filter @pi-harness/db migrate`
Expected: tables created in local Postgres. Verify: `psql $DATABASE_URL -c '\dt'` lists all four tables.

- [ ] **Step 11: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle schema for tasks/runs/events/artifacts"
```

---

## Task 6: Round-trip integration test for db

**Files:**
- Create: `packages/db/test/schema.test.ts`, `packages/db/vitest.config.ts`

- [x] **Step 1: Create `vitest.config.ts`**

`packages/db/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 10000,
    environment: "node",
    setupFiles: [],
  },
});
```

- [x] **Step 2: Write failing test**

`packages/db/test/schema.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, tasks, runs, events } from "../src/index.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("schema round-trip", () => {
  const { db, client } = createDb(url);

  afterAll(async () => {
    await client.end();
  });

  it("inserts and reads a task", async () => {
    const [t] = await db
      .insert(tasks)
      .values({ title: "test", description: "desc" })
      .returning();
    expect(t).toBeDefined();
    expect(t!.status).toBe("backlog");

    const [fetched] = await db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(fetched!.title).toBe("test");

    await db.delete(tasks).where(eq(tasks.id, t!.id));
  });

  it("cascades runs and events when task is deleted", async () => {
    const [t] = await db.insert(tasks).values({ title: "cascade" }).returning();
    const [r] = await db.insert(runs).values({ taskId: t!.id, phase: "brainstorm" }).returning();
    await db.insert(events).values({
      taskId: t!.id,
      runId: r!.id,
      kind: "log",
      payload: { level: "info", text: "hello" },
    });

    await db.delete(tasks).where(eq(tasks.id, t!.id));

    const remainingRuns = await db.select().from(runs).where(eq(runs.taskId, t!.id));
    expect(remainingRuns).toHaveLength(0);
    const remainingEvents = await db.select().from(events).where(eq(events.taskId, t!.id));
    expect(remainingEvents).toHaveLength(0);
  });
});
```

- [x] **Step 3: Run test, verify it passes**

Run: `pnpm --filter @pi-harness/db test`
Expected: PASS — 2 tests. (Requires Postgres up + migrated, done in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add packages/db
git commit -m "test(db): round-trip insert/select + cascade verification"
```

---

## Task 7: Create `@pi-harness/pi-bridge` package — types and stubs

**Files:**
- Create: `packages/pi-bridge/package.json`, `packages/pi-bridge/tsconfig.json`, `packages/pi-bridge/src/types.ts`, `packages/pi-bridge/src/index.ts`

The pi-bridge is the **only** module that imports pi SDKs. v1 ships a thin async wrapper; we keep the surface narrow on purpose.

- [x] **Step 1: Create `packages/pi-bridge/package.json`**

`packages/pi-bridge/package.json`:
```json
{
  "name": "@pi-harness/pi-bridge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint configured'"
  },
  "dependencies": {
    "@pi-harness/shared": "workspace:*",
    "@earendil-works/pi-coding-agent": "^0.73.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [x] **Step 2: Create `packages/pi-bridge/tsconfig.json`**

`packages/pi-bridge/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

- [x] **Step 3: Create `src/types.ts`**

`packages/pi-bridge/src/types.ts`:
```typescript
import type { AgentEvent } from "@pi-harness/shared";

export type PiSessionOptions = {
  cwd: string;
  systemPrompt?: string;
  skills?: string[];
  signal?: AbortSignal;
  onEvent: (e: PiBridgeEvent) => void;
};

export type PiBridgeEvent =
  | { kind: "message_delta"; text: string }
  | { kind: "tool_call"; tool: string; input: unknown }
  | { kind: "tool_result"; tool: string; ok: boolean; output?: unknown }
  | { kind: "log"; level: "info" | "warn" | "error"; text: string };

export type PiSession = {
  prompt(text: string): Promise<PiPromptResult>;
  close(): Promise<void>;
};

export type PiPromptResult = {
  finalText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type PiSubagentSpec = {
  agent: string; // matches a file under subagents/, without `.md`
  task: string;
  cwd: string;
  worktree?: boolean;
  skill?: string;
  signal?: AbortSignal;
};

export type PiSubagentResult = {
  ok: boolean;
  output: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

// Typed convenience for translating PiBridgeEvent to AgentEvent at call sites.
export type EventTranslator = (e: PiBridgeEvent) => Omit<AgentEvent, "id" | "ts" | "runId" | "taskId">;
```

- [x] **Step 4: Create `src/index.ts`**

`packages/pi-bridge/src/index.ts`:
```typescript
export * from "./types.js";
export { createSession } from "./session.js";
export { runSubagent } from "./subagent.js";
```

- [x] **Step 5: Build (will fail; placeholder commit)**

Skip build until Task 8 lands `session.ts` and `subagent.ts`. Do not commit yet.

---

## Task 8: Implement `createSession` and `runSubagent` with mocked tests

The actual pi SDK integration is intentionally minimal: we expose `createSession` (long-lived) and `runSubagent` (one-shot). Implementation uses the SDK's `createAgentSession()` / `createAgentSessionRuntime()`. Tests use a mock so they don't require a live LLM.

**Files:**
- Create: `packages/pi-bridge/src/session.ts`, `packages/pi-bridge/src/subagent.ts`, `packages/pi-bridge/src/_mock.ts`, `packages/pi-bridge/test/session.test.ts`

- [x] **Step 1: Write failing test (uses injected mock)**

`packages/pi-bridge/test/session.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { createSession } from "../src/session.js";
import type { MockPiAdapter } from "../src/_mock.js";

function makeAdapter(): MockPiAdapter {
  return {
    createAgentSession: vi.fn(async (_opts) => ({
      prompt: vi.fn(async (_text: string) => ({
        finalText: "ok",
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.0001,
      })),
      close: vi.fn(async () => {}),
      on: (_event: string, _cb: (...args: unknown[]) => void) => {},
    })),
  };
}

describe("createSession", () => {
  it("returns a session that can prompt and close", async () => {
    const adapter = makeAdapter();
    const events: string[] = [];
    const session = await createSession(
      { cwd: "/tmp", onEvent: (e) => events.push(e.kind) },
      adapter,
    );
    const result = await session.prompt("hello");
    expect(result.finalText).toBe("ok");
    expect(result.inputTokens).toBe(10);
    await session.close();
    expect(adapter.createAgentSession).toHaveBeenCalledOnce();
  });
});
```

- [x] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/pi-bridge test`
Expected: FAIL — `createSession` not exported.

- [x] **Step 3: Implement `_mock.ts`**

`packages/pi-bridge/src/_mock.ts`:
```typescript
// Adapter abstraction so tests can inject a stub instead of the real pi SDK.
export type PiSdkSession = {
  prompt: (text: string) => Promise<{
    finalText: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  close: () => Promise<void>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
};

export type PiSdkAdapter = {
  createAgentSession: (opts: { cwd: string; systemPrompt?: string }) => Promise<PiSdkSession>;
};

export type MockPiAdapter = PiSdkAdapter;
```

- [x] **Step 4: Implement `session.ts`**

`packages/pi-bridge/src/session.ts`:
```typescript
import type { PiSession, PiSessionOptions } from "./types.js";
import type { PiSdkAdapter } from "./_mock.js";

let defaultAdapterPromise: Promise<PiSdkAdapter> | null = null;

async function getDefaultAdapter(): Promise<PiSdkAdapter> {
  if (!defaultAdapterPromise) {
    defaultAdapterPromise = (async () => {
      const mod = await import("@earendil-works/pi-coding-agent");
      return {
        createAgentSession: async (opts) => {
          // The real SDK call. We expose a uniform interface so tests can mock it.
          // @ts-expect-error — SDK types may evolve; pin via package.json.
          return mod.createAgentSession({ cwd: opts.cwd, systemPrompt: opts.systemPrompt });
        },
      };
    })();
  }
  return defaultAdapterPromise;
}

export async function createSession(
  opts: PiSessionOptions,
  adapter?: PiSdkAdapter,
): Promise<PiSession> {
  const sdk = adapter ?? (await getDefaultAdapter());
  const sdkSession = await sdk.createAgentSession({ cwd: opts.cwd, systemPrompt: opts.systemPrompt });

  // Wire SDK events into onEvent. Names approximate the SDK's event surface.
  sdkSession.on("text_delta", (text: unknown) => {
    if (typeof text === "string") opts.onEvent({ kind: "message_delta", text });
  });
  sdkSession.on("tool_execution_start", (tool: unknown) => {
    if (typeof tool === "string") opts.onEvent({ kind: "tool_call", tool, input: undefined });
  });
  sdkSession.on("tool_execution_end", (info: unknown) => {
    const o = info as { tool?: string; ok?: boolean } | undefined;
    if (o?.tool) opts.onEvent({ kind: "tool_result", tool: o.tool, ok: !!o.ok });
  });

  return {
    async prompt(text: string) {
      return sdkSession.prompt(text);
    },
    async close() {
      await sdkSession.close();
    },
  };
}
```

- [x] **Step 5: Implement `subagent.ts`**

`packages/pi-bridge/src/subagent.ts`:
```typescript
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { PiSubagentSpec, PiSubagentResult } from "./types.js";

const SUBAGENTS_ROOT = resolve(process.cwd(), "subagents");

// One-shot subagent runner. Shells out to the `pi` CLI with the agent's prompt
// file and streams JSON events back. We use the CLI rather than the SDK here
// because pi-subagents is implemented as a pi extension and the CLI path is the
// stable contract; the SDK path would require re-implementing extension loading.
export async function runSubagent(spec: PiSubagentSpec): Promise<PiSubagentResult> {
  const piPath = process.env.PI_AGENT_PATH ?? "pi";
  const promptFile = resolve(SUBAGENTS_ROOT, "_vendored", `${spec.agent}.md`);

  const args = [
    "--mode",
    "json",
    "--cwd",
    spec.cwd,
    "--prompt-file",
    promptFile,
    "--",
    spec.task,
  ];

  return await new Promise<PiSubagentResult>((resolveResult) => {
    const child = spawn(piPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      // Best-effort parse of JSONL cost events; ignore parse failures.
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line) as { kind?: string; usage?: Record<string, number> };
          if (evt.kind === "usage" && evt.usage) {
            costUsd += evt.usage.cost_usd ?? 0;
            inputTokens += evt.usage.input_tokens ?? 0;
            outputTokens += evt.usage.output_tokens ?? 0;
          }
        } catch {
          // not json — ignore
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });

    if (spec.signal) {
      spec.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    }

    child.on("close", (code) => {
      resolveResult({
        ok: code === 0,
        output: out,
        error: code === 0 ? undefined : err || `exit ${code}`,
        inputTokens,
        outputTokens,
        costUsd,
      });
    });
  });
}
```

- [x] **Step 6: Run test, verify pass**

Run: `pnpm --filter @pi-harness/pi-bridge test`
Expected: PASS — 1 test.

- [x] **Step 7: Build**

Run: `pnpm --filter @pi-harness/pi-bridge build`
Expected: clean.

- [x] **Step 8: Commit**

```bash
git add packages/pi-bridge
git commit -m "feat(pi-bridge): createSession + runSubagent with mocked test"
```

---

## Task 9: Vendor rpiv-mono subagent prompts

We copy the 13 `.md` agents from `/Users/amankumar/Documents/GitProjects/pi-browser-harness/.pi/agents/` into `subagents/_vendored/` verbatim, preserving their frontmatter. Attribution lives in `subagents/ATTRIBUTION.md`.

**Files:**
- Create: `subagents/_vendored/{13 agent files}`, `subagents/ATTRIBUTION.md`, `subagents/ours/.gitkeep`

- [ ] **Step 1: Copy vendored prompts**

Run:
```bash
mkdir -p subagents/_vendored subagents/ours
cp /Users/amankumar/Documents/GitProjects/pi-browser-harness/.pi/agents/*.md subagents/_vendored/
rm -f subagents/_vendored/.rpiv-managed.json 2>/dev/null
ls subagents/_vendored/ | wc -l
```
Expected output: `13`.

- [ ] **Step 2: Verify expected agent names**

Run:
```bash
ls subagents/_vendored/ | sort
```
Expected (exactly):
```
claim-verifier.md
codebase-analyzer.md
codebase-locator.md
codebase-pattern-finder.md
diff-auditor.md
integration-scanner.md
peer-comparator.md
precedent-locator.md
scope-tracer.md
test-case-locator.md
thoughts-analyzer.md
thoughts-locator.md
web-search-researcher.md
```

- [ ] **Step 3: Create `subagents/ATTRIBUTION.md`**

`subagents/ATTRIBUTION.md`:
```markdown
# Vendored Subagent Attribution

The agent prompts in `_vendored/` are derived from the rpiv-mono project.

- Source: https://github.com/juicesharp/rpiv-mono
- Original location in source repo: `.pi/agents/`
- Vendored on: 2026-05-08
- License: see upstream repository.

These prompts were vendored verbatim. Modifications, if any, are tracked in
`docs/superpowers/specs/2026-05-08-pi-harness-design.md` §9 and in git history
on each `.md` file.

If you fork or distribute pi-harness, retain this attribution and the upstream
license.
```

- [ ] **Step 4: Create `subagents/ours/.gitkeep`**

`subagents/ours/.gitkeep`:
```

```
(empty file — directory placeholder)

- [ ] **Step 5: Commit**

```bash
git add subagents/
git commit -m "feat(subagents): vendor 13 rpiv-mono agents with attribution"
```

---

## Task 10: Subagent loader + test

A tiny module that resolves an agent name to its `.md` path, checks all expected agents are present, and gives the orchestrator a single API to find prompts. Lives outside the workspace packages because both orchestrator and tests need it without a publish boundary.

**Files:**
- Create: `subagents/package.json`, `subagents/tsconfig.json`, `subagents/index.ts`, `subagents/test/loader.test.ts`, `subagents/vitest.config.ts`

- [ ] **Step 1: Create `subagents/package.json`**

`subagents/package.json`:
```json
{
  "name": "@pi-harness/subagents",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint configured'"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Add `subagents` to `pnpm-workspace.yaml`**

Edit `pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "subagents"
```

- [ ] **Step 3: Create `subagents/tsconfig.json`**

`subagents/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "./dist",
    "allowImportingTsExtensions": false
  },
  "include": ["index.ts"]
}
```

- [ ] **Step 4: Write failing test**

`subagents/test/loader.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { resolveAgentPath, listVendoredAgents, EXPECTED_VENDORED_AGENTS } from "../index.js";
import { existsSync } from "node:fs";

describe("subagent loader", () => {
  it("lists 13 vendored agents", () => {
    const agents = listVendoredAgents();
    expect(agents).toHaveLength(13);
    for (const name of EXPECTED_VENDORED_AGENTS) {
      expect(agents).toContain(name);
    }
  });

  it("resolveAgentPath returns an existing file for a vendored agent", () => {
    const p = resolveAgentPath("codebase-locator");
    expect(p).toMatch(/_vendored\/codebase-locator\.md$/);
    expect(existsSync(p)).toBe(true);
  });

  it("resolveAgentPath throws for an unknown agent", () => {
    expect(() => resolveAgentPath("does-not-exist")).toThrow(/unknown agent/i);
  });
});
```

- [ ] **Step 5: Run test, verify fail**

Run: `pnpm --filter @pi-harness/subagents test`
Expected: FAIL — `resolveAgentPath` not found.

- [ ] **Step 6: Implement `index.ts`**

`subagents/index.ts`:
```typescript
import { readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VENDORED_DIR = resolve(__dirname, "_vendored");
const OURS_DIR = resolve(__dirname, "ours");

export const EXPECTED_VENDORED_AGENTS = [
  "claim-verifier",
  "codebase-analyzer",
  "codebase-locator",
  "codebase-pattern-finder",
  "diff-auditor",
  "integration-scanner",
  "peer-comparator",
  "precedent-locator",
  "scope-tracer",
  "test-case-locator",
  "thoughts-analyzer",
  "thoughts-locator",
  "web-search-researcher",
] as const;

export type VendoredAgent = (typeof EXPECTED_VENDORED_AGENTS)[number];

export function listVendoredAgents(): string[] {
  return readdirSync(VENDORED_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

export function listOurAgents(): string[] {
  if (!existsSync(OURS_DIR)) return [];
  return readdirSync(OURS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

export function resolveAgentPath(name: string): string {
  const vendored = resolve(VENDORED_DIR, `${name}.md`);
  if (existsSync(vendored)) return vendored;
  const ours = resolve(OURS_DIR, `${name}.md`);
  if (existsSync(ours)) return ours;
  throw new Error(`unknown agent: ${name}`);
}
```

- [ ] **Step 7: Run test, verify pass**

Run: `pnpm install && pnpm --filter @pi-harness/subagents test`
Expected: PASS — 3 tests.

- [ ] **Step 8: Build**

Run: `pnpm --filter @pi-harness/subagents build`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add subagents/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(subagents): loader with name resolution + vendored agent presence test"
```

---

## Task 11: Wire pi-bridge to use subagent loader

Replace the hard-coded `_vendored/${spec.agent}.md` path lookup in `runSubagent` with `resolveAgentPath` so user-authored agents in `subagents/ours/` are also found.

**Files:**
- Modify: `packages/pi-bridge/package.json`, `packages/pi-bridge/src/subagent.ts`

- [x] **Step 1: Add subagents dep**

Edit `packages/pi-bridge/package.json`, add to `dependencies`:
```json
"@pi-harness/subagents": "workspace:*"
```

- [x] **Step 2: Update `subagent.ts`**

In `packages/pi-bridge/src/subagent.ts`:

Replace the lines:
```typescript
import { resolve } from "node:path";
...
const SUBAGENTS_ROOT = resolve(process.cwd(), "subagents");
...
const promptFile = resolve(SUBAGENTS_ROOT, "_vendored", `${spec.agent}.md`);
```

With:
```typescript
import { resolveAgentPath } from "@pi-harness/subagents";
...
// (delete SUBAGENTS_ROOT)
...
const promptFile = resolveAgentPath(spec.agent);
```

Final `subagent.ts` top section:
```typescript
import { spawn } from "node:child_process";
import { resolveAgentPath } from "@pi-harness/subagents";
import type { PiSubagentSpec, PiSubagentResult } from "./types.js";

export async function runSubagent(spec: PiSubagentSpec): Promise<PiSubagentResult> {
  const piPath = process.env.PI_AGENT_PATH ?? "pi";
  const promptFile = resolveAgentPath(spec.agent);
  // ...rest unchanged
```

- [x] **Step 3: Install + build**

Run: `pnpm install && pnpm --filter @pi-harness/pi-bridge build`
Expected: clean.

- [x] **Step 4: Run all tests**

Run: `pnpm test`
Expected: all packages pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-bridge pnpm-lock.yaml
git commit -m "refactor(pi-bridge): use subagent loader for path resolution"
```

---

## Task 12: Verify the whole substrate from a fresh clone

A smoke task: simulate what a new contributor sees.

**Files:** none (verification only)

- [ ] **Step 1: Clean build**

Run: `pnpm -r exec rm -rf dist node_modules .turbo && rm -rf node_modules && pnpm install`
Expected: lockfile resolved, all workspaces installed.

- [x] **Step 2: Typecheck all**

Run: `pnpm typecheck`
Expected: clean across `@pi-harness/shared`, `@pi-harness/db`, `@pi-harness/pi-bridge`, `@pi-harness/subagents`.

- [x] **Step 3: Build all**

Run: `pnpm build`
Expected: clean. Each package has a `dist/` with `.js` + `.d.ts`.

- [x] **Step 4: Test all**

Run: `pnpm test`
Expected: PASS — scenario-schema (4), db round-trip (2), pi-bridge session (1), subagent loader (3) = 10 tests passing.

- [ ] **Step 5: Verify Postgres still good**

Run: `psql $DATABASE_URL -c '\dt'`
Expected: `tasks`, `runs`, `events`, `artifacts`.

- [ ] **Step 6: Commit a substrate marker (optional)**

If everything passes, no commit needed — the green CI is the marker. Otherwise capture lessons in `docs/learnings.md` for the next plan to consume.

---

## Self-review

**Spec coverage** (against `2026-05-08-pi-harness-design.md`):

- §2 Reuse vs build → Tasks 7–11 (pi-bridge wraps `@earendil-works/pi-coding-agent`, `pi-subagents` consumed at runtime via `runSubagent`). ✅
- §9.1 Vendored rpiv agents → Task 9 (13 agents), Task 10 (loader). ✅
- §10.1 Postgres → Tasks 2, 5, 6. ✅
- §12 Repo layout → Tasks 1, 3, 5, 7, 9 establish `apps/` (empty), `packages/`, `subagents/`. `apps/` directory will be populated in Plans 2–4. ✅
- §8 Verification → Scenario types/schema in Task 4; gate behavior implemented in Plan 3. ✅
- §3 Architecture (Task / Run / Event tables) → Task 5. ✅

Out-of-scope items deferred to later plans (orchestrator state machine, agent prompts, dashboard, worktree manager) are explicitly listed at the top of this plan, not implicitly skipped.

**Placeholder scan:** none. Every step has runnable content.

**Type consistency:**
- `Task.status` in `shared` (Task 3) uses string literal union matching column default in `db/schema.ts` (Task 5: default `"backlog"`). ✅
- `Run.phase` uses `Phase` literal union (Task 3); db column is `text` (Task 5) — type narrowing happens at the application boundary. Acceptable for Plan 1; Plan 2 will add a Drizzle CHECK or enum.
- `PiBridgeEvent` in `pi-bridge/src/types.ts` (Task 7) is a structural subset of `AgentEvent` from `shared` (Task 3) — translation happens at orchestrator boundary in Plan 2. Names align (`message_delta`, `tool_call`, `tool_result`, `log`).
- `EXPECTED_VENDORED_AGENTS` in `subagents/index.ts` (Task 10) matches the file list verified in Task 9, Step 2. ✅

---

## Plan 1 → Plan 2 handoff

When this plan is green, Plan 2 (Orchestrator core) can begin. It will consume:

- `@pi-harness/shared` types (`Task`, `Run`, `AgentEvent`, `Scenario`)
- `@pi-harness/db` (the Drizzle client + schema)
- `@pi-harness/pi-bridge` (`createSession`, `runSubagent`)
- `@pi-harness/subagents` (`resolveAgentPath`, `listVendoredAgents`)

Plan 2 will add `apps/orchestrator/` with the state machine, worktree manager, and event-bus, and will be the first place we wire up real pi runs.
