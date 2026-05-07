# pi-harness Plan 2: Orchestrator Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the orchestrator service — the brain of pi-harness. It owns the task state machine, dispatches pi sessions and subagents per phase, manages worktrees, persists every event, and exposes a typed HTTP + SSE API the dashboard consumes.

**Architecture:** A single Node service (`apps/orchestrator/`) with three internal layers:

1. **Domain layer** (`src/domain/`) — pure functions: state-machine guards, phase chain definition, event factories. No I/O.
2. **Adapters** (`src/adapters/`) — `WorktreeManager` (git ops), `PiDispatcher` (wraps `pi-bridge`), `EventStore` (DB writes + in-memory pub/sub), `RunStore` (DB CRUD).
3. **HTTP** (`src/http/`) — Fastify server with REST routes (`/api/tasks`, `/api/runs`, `/api/events`) and SSE (`/api/runs/:id/events`).

The state machine is the contract. Every other module reads/writes through it.

**Tech Stack:** TypeScript, Fastify 5 (HTTP + SSE), Drizzle, Zod (request validation), `simple-git` (worktree ops), Vitest (unit + integration), `@pi-harness/shared`, `@pi-harness/db`, `@pi-harness/pi-bridge`.

**Spec reference:** `docs/superpowers/specs/2026-05-08-pi-harness-design.md` — §3 architecture, §4 kanban states, §5 worktree-per-task, §8.3 failure handling, §10 dashboard surfaces.

**Mock reference:** The dashboard mocks at `docs/mocks/` are the consumer contract. Specifically:
- `task-detail.html` — every "Run Context" sidebar value (worktree path, branch, commits, active subagents, files changed, cost, tokens, retry count, phase budget %) must be queryable from this orchestrator.
- `kanban.html` — the page header counts (`15 tasks · 4 runs in flight · 1 awaiting human`) must be computable from a single endpoint.
- The density rule (`memory/feedback_dashboard_density.md`) means **every value the dashboard renders must be backed by real orchestrator state** — no placeholder counts.

**Out of scope for this plan:** the agent prompts themselves (Plan 3), the dashboard UI (Plan 4), and the actual `verifier` / `coder` phase logic (Plan 3 — orchestrator just dispatches them). This plan stops at "the orchestrator can run an end-to-end mocked phase chain and stream events to a curl `-N` SSE client."

---

## File Structure

This plan creates these files:

| Path | Responsibility |
|---|---|
| `apps/orchestrator/package.json` | Manifest (Fastify, simple-git, deps) |
| `apps/orchestrator/tsconfig.json` | TS config |
| `apps/orchestrator/vitest.config.ts` | Test config |
| `apps/orchestrator/src/index.ts` | Entry point — boot Fastify, wire adapters |
| `apps/orchestrator/src/config.ts` | Env-driven config (port, db url, runs dir) |
| `apps/orchestrator/src/domain/state-machine.ts` | `transition(task, action)` — pure |
| `apps/orchestrator/src/domain/phase-chain.ts` | Workflow → phase list mapping |
| `apps/orchestrator/src/domain/events.ts` | `mkEvent()` factories, payload typing |
| `apps/orchestrator/src/domain/errors.ts` | Typed error classes |
| `apps/orchestrator/src/adapters/worktree.ts` | `WorktreeManager` — create / remove / reconcile |
| `apps/orchestrator/src/adapters/run-store.ts` | `RunStore` — DB CRUD on `tasks` / `runs` |
| `apps/orchestrator/src/adapters/event-store.ts` | `EventStore` — persist + pub/sub |
| `apps/orchestrator/src/adapters/dispatcher.ts` | `PiDispatcher` — phase → pi-bridge call |
| `apps/orchestrator/src/runner/run-loop.ts` | Drives a task through its phase chain |
| `apps/orchestrator/src/runner/janitor.ts` | Reconciles worktrees vs DB on boot |
| `apps/orchestrator/src/http/server.ts` | Fastify factory |
| `apps/orchestrator/src/http/routes/tasks.ts` | REST: list, get, create, transition |
| `apps/orchestrator/src/http/routes/runs.ts` | REST: list runs, get run detail |
| `apps/orchestrator/src/http/routes/events.ts` | SSE: subscribe to a run's events |
| `apps/orchestrator/src/http/routes/health.ts` | `/healthz` |
| `apps/orchestrator/src/http/schemas.ts` | Zod request/response schemas |
| `apps/orchestrator/test/state-machine.test.ts` | All transitions + guards |
| `apps/orchestrator/test/phase-chain.test.ts` | Workflow → phases is canonical |
| `apps/orchestrator/test/worktree.test.ts` | Real-git integration: create + remove |
| `apps/orchestrator/test/event-store.test.ts` | Persist + subscribe round-trip |
| `apps/orchestrator/test/dispatcher.test.ts` | Phase dispatch with mocked pi-bridge |
| `apps/orchestrator/test/run-loop.test.ts` | End-to-end mocked phase chain |
| `apps/orchestrator/test/http.test.ts` | Fastify routes via injected requests |
| `apps/orchestrator/test/sse.test.ts` | SSE end-to-end with a real HTTP client |

The split between `domain/` (pure) and `adapters/` (I/O) is deliberate: tests for `domain/` need no fixtures; tests for `adapters/` need either a DB or a tmp git repo. This keeps the test pyramid healthy.

---

## Task 1: Initialize `apps/orchestrator/` package

**Files:**
- Create: `apps/orchestrator/package.json`, `apps/orchestrator/tsconfig.json`, `apps/orchestrator/vitest.config.ts`, `apps/orchestrator/src/index.ts`

- [ ] **Step 1: Create `apps/orchestrator/package.json`**

`apps/orchestrator/package.json`:
```json
{
  "name": "@pi-harness/orchestrator",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "echo 'no lint configured'"
  },
  "dependencies": {
    "@pi-harness/db": "workspace:*",
    "@pi-harness/pi-bridge": "workspace:*",
    "@pi-harness/shared": "workspace:*",
    "@pi-harness/subagents": "workspace:*",
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "simple-git": "^3.27.0",
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

`apps/orchestrator/tsconfig.json`:
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

- [ ] **Step 3: Create `vitest.config.ts`**

`apps/orchestrator/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    environment: "node",
    setupFiles: [],
  },
});
```

- [ ] **Step 4: Create skeleton `src/index.ts`**

`apps/orchestrator/src/index.ts`:
```typescript
// Bootstraps the orchestrator. Wired up in Task 14.
console.log("orchestrator boot — not yet wired");
```

- [ ] **Step 5: Install + typecheck**

Run: `pnpm install && pnpm --filter @pi-harness/orchestrator typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator
git commit -m "feat(orchestrator): scaffold app package"
```

---

## Task 2: Config module

A single file that reads env vars with sensible defaults. Every other module imports from here so tests can override.

**Files:**
- Create: `apps/orchestrator/src/config.ts`

- [ ] **Step 1: Create `src/config.ts`**

`apps/orchestrator/src/config.ts`:
```typescript
import "dotenv/config";

export type OrchestratorConfig = {
  port: number;
  databaseUrl: string;
  runsDir: string;
  worktreesDir: string;
  // Hard cap on retries per task before requiring human triage.
  // Spec §8.3: cap = 2 retries.
  retryCap: number;
  // Concurrent tasks in `executing`.
  // Spec §4: default 2.
  executingConcurrency: number;
  // Path to repo root the harness operates on. Worktrees branch off this repo's HEAD.
  // For now this is the same repo the orchestrator runs from; multi-repo support is v2.
  repoRoot: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    port: parseInt(env.PORT ?? "4000", 10),
    databaseUrl:
      env.DATABASE_URL ??
      "postgresql://piharness:piharness@localhost:5433/piharness",
    runsDir: env.HARNESS_RUNS_DIR ?? ".harness/runs",
    worktreesDir: env.HARNESS_WORKTREES_DIR ?? ".harness/worktrees",
    retryCap: parseInt(env.HARNESS_RETRY_CAP ?? "2", 10),
    executingConcurrency: parseInt(env.HARNESS_EXECUTING_CONCURRENCY ?? "2", 10),
    repoRoot: env.HARNESS_REPO_ROOT ?? process.cwd(),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pi-harness/orchestrator typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/orchestrator/src/config.ts
git commit -m "feat(orchestrator): config module with env defaults"
```

---

## Task 3: Domain — typed errors

The state machine, dispatcher, and HTTP layer all need to distinguish "user error" (400) from "invalid state" (409) from "infrastructure error" (500). Centralize the error taxonomy.

**Files:**
- Create: `apps/orchestrator/src/domain/errors.ts`, `apps/orchestrator/test/errors.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/errors.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  HarnessError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
  isHarnessError,
} from "../src/domain/errors.js";

describe("HarnessError", () => {
  it("InvalidTransitionError carries from + to + reason", () => {
    const err = new InvalidTransitionError("backlog", "verifying", "no plan");
    expect(err.status).toBe(409);
    expect(err.code).toBe("invalid_transition");
    expect(err.message).toContain("backlog");
    expect(err.message).toContain("verifying");
  });

  it("NotFoundError is 404", () => {
    expect(new NotFoundError("task", "42").status).toBe(404);
  });

  it("ValidationError is 400", () => {
    expect(new ValidationError("bad payload").status).toBe(400);
  });

  it("isHarnessError narrows", () => {
    const e: unknown = new ValidationError("x");
    if (isHarnessError(e)) {
      expect(e.status).toBe(400);
    } else {
      throw new Error("should narrow");
    }
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/errors.ts`**

`apps/orchestrator/src/domain/errors.ts`:
```typescript
export type HarnessErrorCode =
  | "invalid_transition"
  | "not_found"
  | "validation"
  | "dispatch_failed"
  | "worktree_failed"
  | "internal";

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: HarnessErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class InvalidTransitionError extends HarnessError {
  constructor(from: string, to: string, reason: string) {
    super(
      "invalid_transition",
      409,
      `cannot transition from ${from} to ${to}: ${reason}`,
      { from, to, reason },
    );
  }
}

export class NotFoundError extends HarnessError {
  constructor(resource: string, id: string) {
    super("not_found", 404, `${resource} not found: ${id}`, { resource, id });
  }
}

export class ValidationError extends HarnessError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("validation", 400, message, details);
  }
}

export class DispatchError extends HarnessError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("dispatch_failed", 500, message, details);
  }
}

export class WorktreeError extends HarnessError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("worktree_failed", 500, message, details);
  }
}

export function isHarnessError(e: unknown): e is HarnessError {
  return e instanceof HarnessError;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/domain/errors.ts apps/orchestrator/test/errors.test.ts
git commit -m "feat(orchestrator): typed error taxonomy"
```

---

## Task 4: Domain — phase chain definition

A workflow is a typed phase list. v1 has exactly one workflow (`backend-feature`). The chain is a pure function — no DB, no side effects.

**Files:**
- Create: `apps/orchestrator/src/domain/phase-chain.ts`, `apps/orchestrator/test/phase-chain.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/phase-chain.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { phasesFor, nextPhase, isLastPhase } from "../src/domain/phase-chain.js";

describe("phase-chain", () => {
  it("backend-feature has the canonical 5-phase chain", () => {
    expect(phasesFor("backend-feature")).toEqual([
      "brainstorm",
      "plan",
      "code",
      "verify",
      "pr",
    ]);
  });

  it("nextPhase returns the next phase", () => {
    expect(nextPhase("backend-feature", "brainstorm")).toBe("plan");
    expect(nextPhase("backend-feature", "code")).toBe("verify");
  });

  it("nextPhase returns null after pr", () => {
    expect(nextPhase("backend-feature", "pr")).toBeNull();
  });

  it("isLastPhase identifies pr as terminal", () => {
    expect(isLastPhase("backend-feature", "pr")).toBe(true);
    expect(isLastPhase("backend-feature", "verify")).toBe(false);
  });

  it("nextPhase throws for unknown phase", () => {
    // @ts-expect-error testing runtime guard
    expect(() => nextPhase("backend-feature", "garbage")).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/phase-chain.ts`**

`apps/orchestrator/src/domain/phase-chain.ts`:
```typescript
import type { Phase, Workflow } from "@pi-harness/shared";

const CHAINS: Record<Workflow, readonly Phase[]> = {
  "backend-feature": ["brainstorm", "plan", "code", "verify", "pr"],
};

export function phasesFor(workflow: Workflow): readonly Phase[] {
  return CHAINS[workflow];
}

export function nextPhase(workflow: Workflow, current: Phase): Phase | null {
  const chain = CHAINS[workflow];
  const i = chain.indexOf(current);
  if (i === -1) {
    throw new Error(`phase ${current} is not in workflow ${workflow}`);
  }
  return chain[i + 1] ?? null;
}

export function isLastPhase(workflow: Workflow, phase: Phase): boolean {
  return nextPhase(workflow, phase) === null;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/domain/phase-chain.ts apps/orchestrator/test/phase-chain.test.ts
git commit -m "feat(orchestrator): phase-chain definition for backend-feature"
```

---

## Task 5: Domain — state machine

The most-tested module in this plan. Every action that changes a task's status flows through `transition()`. The state machine is exhaustive: it returns either the new task state or a typed error. No exceptions for control flow — errors are values.

**Files:**
- Create: `apps/orchestrator/src/domain/state-machine.ts`, `apps/orchestrator/test/state-machine.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/state-machine.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import type { Task } from "@pi-harness/shared";
import { transition, canStart } from "../src/domain/state-machine.js";

function mkTask(status: Task["status"], overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    title: "test",
    description: "",
    status,
    workflow: null,
    worktreePath: null,
    branchName: null,
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("transition", () => {
  it("user_start_brainstorm: backlog → brainstorming, sets workflow", () => {
    const t = mkTask("backlog");
    const r = transition(t, { type: "user_start_brainstorm", workflow: "backend-feature" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("brainstorming");
      expect(r.task.workflow).toBe("backend-feature");
    }
  });

  it("rejects user_start_brainstorm from any non-backlog status", () => {
    const t = mkTask("planning", { workflow: "backend-feature" });
    const r = transition(t, { type: "user_start_brainstorm", workflow: "backend-feature" });
    expect(r.ok).toBe(false);
  });

  it("agent_phase_succeeded: brainstorming → planning", () => {
    const t = mkTask("brainstorming", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_phase_succeeded", phase: "brainstorm" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("planning");
  });

  it("agent_phase_succeeded: verify → ready_to_ship", () => {
    const t = mkTask("verifying", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_phase_succeeded", phase: "verify" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("ready_to_ship");
  });

  it("agent_phase_succeeded: pr → done", () => {
    const t = mkTask("ready_to_ship", { workflow: "backend-feature" });
    const r = transition(t, { type: "agent_phase_succeeded", phase: "pr" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("done");
  });

  it("agent_phase_failed during verify with retries left → executing + retryCount++", () => {
    const t = mkTask("verifying", { workflow: "backend-feature", retryCount: 0 });
    const r = transition(t, { type: "agent_phase_failed", phase: "verify", retryCap: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.task.status).toBe("executing");
      expect(r.task.retryCount).toBe(1);
    }
  });

  it("agent_phase_failed during verify when retryCap exhausted → verification_failed", () => {
    const t = mkTask("verifying", { workflow: "backend-feature", retryCount: 2 });
    const r = transition(t, { type: "agent_phase_failed", phase: "verify", retryCap: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.task.status).toBe("verification_failed");
  });

  it("user_cancel: any non-terminal → cancelled", () => {
    for (const s of ["backlog", "brainstorming", "planning", "executing", "verifying", "verification_failed", "ready_to_ship"] as const) {
      const t = mkTask(s, { workflow: "backend-feature" });
      const r = transition(t, { type: "user_cancel" });
      expect(r.ok, `from ${s}`).toBe(true);
      if (r.ok) expect(r.task.status).toBe("cancelled");
    }
  });

  it("user_cancel from done is rejected", () => {
    const t = mkTask("done", { workflow: "backend-feature" });
    const r = transition(t, { type: "user_cancel" });
    expect(r.ok).toBe(false);
  });
});

describe("canStart", () => {
  it("returns true when concurrency below limit", () => {
    expect(canStart({ runningCount: 1, cap: 2 })).toBe(true);
  });
  it("returns false at cap", () => {
    expect(canStart({ runningCount: 2, cap: 2 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test state-machine`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/state-machine.ts`**

`apps/orchestrator/src/domain/state-machine.ts`:
```typescript
import type { Phase, Task, TaskStatus, Workflow } from "@pi-harness/shared";
import { InvalidTransitionError } from "./errors.js";

// Action input — discriminated union of every event that can change a task's state.
export type TransitionAction =
  | { type: "user_start_brainstorm"; workflow: Workflow }
  | { type: "user_approve_plan" }
  | { type: "user_approve_scenarios" }
  | { type: "user_cancel" }
  | { type: "user_retry_failed" }
  | { type: "agent_phase_succeeded"; phase: Phase }
  | { type: "agent_phase_failed"; phase: Phase; retryCap: number };

export type TransitionResult =
  | { ok: true; task: Task }
  | { ok: false; error: InvalidTransitionError };

// Map (current_status, action) → next_status. Returning a value (not throwing)
// makes the whole machine exhaustive and testable; callers decide what to do
// with the error.
export function transition(task: Task, action: TransitionAction): TransitionResult {
  const now = new Date();
  const advance = (status: TaskStatus, extra: Partial<Task> = {}): TransitionResult => ({
    ok: true,
    task: { ...task, ...extra, status, updatedAt: now },
  });
  const reject = (reason: string): TransitionResult => ({
    ok: false,
    error: new InvalidTransitionError(task.status, "?", reason),
  });

  switch (action.type) {
    case "user_start_brainstorm":
      if (task.status !== "backlog") return reject("must be in backlog");
      return advance("brainstorming", { workflow: action.workflow });

    case "user_approve_plan":
      // Brainstorm → Planning happens when brainstorm phase succeeds.
      // Planning → Executing happens when *user* approves plan.
      if (task.status !== "planning") return reject("must be in planning");
      return advance("executing");

    case "user_approve_scenarios":
      // v1 scenarios are reviewed in the same step as the plan; this is reserved
      // for v2 when scenario review becomes its own step.
      if (task.status !== "planning") return reject("must be in planning");
      return advance("executing");

    case "user_cancel":
      if (task.status === "done" || task.status === "cancelled") {
        return reject("already terminal");
      }
      return advance("cancelled");

    case "user_retry_failed":
      if (task.status !== "verification_failed") return reject("not failed");
      // Reset retry counter — user has triaged.
      return advance("executing", { retryCount: 0 });

    case "agent_phase_succeeded": {
      const map: Partial<Record<Phase, { from: TaskStatus; to: TaskStatus }>> = {
        brainstorm: { from: "brainstorming", to: "planning" },
        plan: { from: "planning", to: "planning" }, // wait for user approval
        code: { from: "executing", to: "verifying" },
        verify: { from: "verifying", to: "ready_to_ship" },
        pr: { from: "ready_to_ship", to: "done" },
      };
      const m = map[action.phase];
      if (!m) return reject(`no rule for phase ${action.phase}`);
      if (task.status !== m.from) return reject(`expected ${m.from}, got ${task.status}`);
      return advance(m.to);
    }

    case "agent_phase_failed":
      if (action.phase === "verify") {
        // Spec §8.3 — verify failures retry (retryCap times) before triage.
        if (task.retryCount < action.retryCap) {
          return advance("executing", { retryCount: task.retryCount + 1 });
        }
        return advance("verification_failed");
      }
      // Any other phase failing puts the task in verification_failed for triage.
      // (No silent retries on brainstorm/plan/code/pr.)
      return advance("verification_failed");
  }
}

export function canStart(opts: { runningCount: number; cap: number }): boolean {
  return opts.runningCount < opts.cap;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test state-machine`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/domain/state-machine.ts apps/orchestrator/test/state-machine.test.ts
git commit -m "feat(orchestrator): state machine for task transitions"
```

---

## Task 6: Domain — event factories

Centralized constructors for `AgentEvent`. Every site that creates an event uses these — guarantees `id`/`ts` are set consistently and the discriminated union stays exhaustive.

**Files:**
- Create: `apps/orchestrator/src/domain/events.ts`, `apps/orchestrator/test/events.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/events.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { mkEvent } from "../src/domain/events.js";

describe("mkEvent", () => {
  it("phase_started carries phase", () => {
    const e = mkEvent({ runId: "r1", taskId: "t1", kind: "phase_started", phase: "code" });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.kind).toBe("phase_started");
    if (e.kind === "phase_started") expect(e.phase).toBe("code");
    expect(e.ts).toBeInstanceOf(Date);
  });

  it("tool_call carries tool + input", () => {
    const e = mkEvent({
      runId: "r1",
      taskId: "t1",
      kind: "tool_call",
      tool: "Read",
      input: { path: "x" },
    });
    expect(e.kind).toBe("tool_call");
  });

  it("log requires level + text", () => {
    const e = mkEvent({ runId: "r1", taskId: "t1", kind: "log", level: "info", text: "hi" });
    expect(e.kind).toBe("log");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test events`
Expected: FAIL.

- [ ] **Step 3: Implement `src/domain/events.ts`**

`apps/orchestrator/src/domain/events.ts`:
```typescript
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@pi-harness/shared";

type MkEventInput =
  | { runId: string; taskId: string; kind: "phase_started"; phase: string }
  | { runId: string; taskId: string; kind: "phase_ended"; phase: string; status: "succeeded" | "failed" | "cancelled" }
  | { runId: string; taskId: string; kind: "message_delta"; text: string }
  | { runId: string; taskId: string; kind: "tool_call"; tool: string; input: unknown }
  | { runId: string; taskId: string; kind: "tool_result"; tool: string; ok: boolean }
  | { runId: string; taskId: string; kind: "log"; level: "info" | "warn" | "error"; text: string };

export function mkEvent(input: MkEventInput): AgentEvent {
  return { id: randomUUID(), ts: new Date(), ...input } as AgentEvent;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test events`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/domain/events.ts apps/orchestrator/test/events.test.ts
git commit -m "feat(orchestrator): event factory"
```

---

## Task 7: Adapter — `WorktreeManager`

Owns git worktree lifecycle for tasks. v1 uses `simple-git`. The manager is stateless: it computes paths from a `taskId` and shells out to `git worktree`. The reconcile step (janitor) walks the worktree dir and matches against tasks in the DB.

**Files:**
- Create: `apps/orchestrator/src/adapters/worktree.ts`, `apps/orchestrator/test/worktree.test.ts`

- [ ] **Step 1: Write failing test (real git, real fs, in tmp dir)**

`apps/orchestrator/test/worktree.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { WorktreeManager } from "../src/adapters/worktree.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "wt-test-"));
  // initialize a bare-ish source repo
  const repo = join(scratch, "repo");
  await mkdir(repo, { recursive: true });
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  // Need an initial commit so worktree creation works.
  await writeFile(join(repo, "README.md"), "init");
  await git.add("README.md");
  await git.commit("init");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("WorktreeManager", () => {
  it("create() makes a worktree at the configured path with a new branch", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    const wt = await wm.create("task-1", "feat/test");
    expect(wt.path).toBe(join(wtDir, "task-1"));
    expect(wt.branch).toBe("feat/test");

    // Worktree's HEAD is the new branch
    const wtGit = simpleGit(wt.path);
    const head = await wtGit.revparse(["--abbrev-ref", "HEAD"]);
    expect(head.trim()).toBe("feat/test");
  });

  it("remove() deletes the worktree", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    const wt = await wm.create("task-2", "feat/two");
    await wm.remove("task-2");

    const list = await wm.list();
    expect(list.find((w) => w.taskId === "task-2")).toBeUndefined();
  });

  it("list() returns all known worktrees", async () => {
    const repo = join(scratch, "repo");
    const wtDir = join(scratch, "worktrees");
    const wm = new WorktreeManager({ repoRoot: repo, worktreesDir: wtDir });

    await wm.create("a", "feat/a");
    await wm.create("b", "feat/b");

    const list = await wm.list();
    const ids = list.map((w) => w.taskId).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test worktree`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/adapters/worktree.ts`**

`apps/orchestrator/src/adapters/worktree.ts`:
```typescript
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { WorktreeError } from "../domain/errors.js";

export type WorktreeInfo = {
  taskId: string;
  path: string;
  branch: string;
};

export type WorktreeManagerOptions = {
  repoRoot: string;
  worktreesDir: string;
};

// Owns the lifecycle of git worktrees, one per task. Spec §5.
//
// NOTE: this is the *one* abstraction we own over git. We do not delegate to
// pi-subagents' worktree option because the orchestrator needs to track
// worktrees independent of any specific subagent run (see janitor — Task 13).
export class WorktreeManager {
  private readonly git: SimpleGit;
  private readonly opts: WorktreeManagerOptions;

  constructor(opts: WorktreeManagerOptions) {
    this.opts = {
      repoRoot: resolve(opts.repoRoot),
      worktreesDir: resolve(opts.worktreesDir),
    };
    this.git = simpleGit(this.opts.repoRoot);
  }

  pathFor(taskId: string): string {
    return join(this.opts.worktreesDir, taskId);
  }

  async create(taskId: string, branch: string): Promise<WorktreeInfo> {
    const path = this.pathFor(taskId);
    if (existsSync(path)) {
      throw new WorktreeError(`worktree already exists for ${taskId}`, { path });
    }
    await mkdir(this.opts.worktreesDir, { recursive: true });
    try {
      // `-b <branch>` creates the branch; defaults to HEAD as the start point.
      await this.git.raw(["worktree", "add", "-b", branch, path]);
    } catch (e) {
      throw new WorktreeError(`git worktree add failed: ${(e as Error).message}`, {
        taskId,
        branch,
        path,
      });
    }
    return { taskId, path, branch };
  }

  async remove(taskId: string): Promise<void> {
    const path = this.pathFor(taskId);
    if (!existsSync(path)) return;
    try {
      await this.git.raw(["worktree", "remove", "--force", path]);
    } catch (e) {
      throw new WorktreeError(`git worktree remove failed: ${(e as Error).message}`, {
        taskId,
        path,
      });
    }
  }

  async list(): Promise<WorktreeInfo[]> {
    const raw = await this.git.raw(["worktree", "list", "--porcelain"]);
    const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
    const out: WorktreeInfo[] = [];
    for (const block of blocks) {
      const lines = block.split("\n");
      const wtPathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!wtPathLine) continue;
      const path = wtPathLine.slice("worktree ".length);
      // Skip the main repo's own worktree.
      if (path === this.opts.repoRoot) continue;
      // Only include worktrees under our managed dir.
      if (!path.startsWith(this.opts.worktreesDir)) continue;
      const branch = branchLine ? branchLine.slice("branch refs/heads/".length) : "(detached)";
      const taskId = path.slice(this.opts.worktreesDir.length + 1);
      out.push({ taskId, path, branch });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test worktree`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/adapters/worktree.ts apps/orchestrator/test/worktree.test.ts
git commit -m "feat(orchestrator): WorktreeManager (create/remove/list)"
```

---

## Task 8: Adapter — `RunStore`

The DB-facing interface for tasks and runs. Thin wrappers around Drizzle that return domain types (not row types). Hides the Postgres column-name conversions and centralizes "find by status" queries the dashboard hits frequently.

**Files:**
- Create: `apps/orchestrator/src/adapters/run-store.ts`, `apps/orchestrator/test/run-store.test.ts`

- [ ] **Step 1: Write failing test (uses real Postgres from Plan 1 docker-compose)**

`apps/orchestrator/test/run-store.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("RunStore", () => {
  const { db, client } = createDb(url);
  const store = new RunStore(db);

  beforeAll(async () => {
    // Migration is applied by Plan 1 Task 5 step 10. Tests assume tables exist.
  });

  beforeEach(async () => {
    // Clean slate per test.
    await db.execute("delete from tasks");
  });

  afterAll(async () => {
    await client.end();
  });

  it("createTask + getTask round-trip", async () => {
    const t = await store.createTask({ title: "round-trip", description: "" });
    expect(t.id).toBeDefined();
    expect(t.status).toBe("backlog");

    const fetched = await store.getTask(t.id);
    expect(fetched.title).toBe("round-trip");
  });

  it("listTasksByStatus returns only matching", async () => {
    const a = await store.createTask({ title: "a" });
    await store.createTask({ title: "b" });
    await store.updateTaskStatus(a.id, "brainstorming");

    const back = await store.listTasksByStatus("backlog");
    const brain = await store.listTasksByStatus("brainstorming");
    expect(back).toHaveLength(1);
    expect(brain).toHaveLength(1);
    expect(brain[0]!.id).toBe(a.id);
  });

  it("createRun + listRuns returns runs in order", async () => {
    const t = await store.createTask({ title: "with-runs" });
    await store.createRun({ taskId: t.id, phase: "brainstorm" });
    await store.createRun({ taskId: t.id, phase: "plan" });

    const runs = await store.listRuns(t.id);
    expect(runs.map((r) => r.phase)).toEqual(["brainstorm", "plan"]);
  });

  it("countByStatus returns the kanban summary", async () => {
    await store.createTask({ title: "a" });
    await store.createTask({ title: "b" });
    const t = await store.createTask({ title: "c" });
    await store.updateTaskStatus(t.id, "executing");

    const counts = await store.countByStatus();
    expect(counts.backlog).toBe(2);
    expect(counts.executing).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test run-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/adapters/run-store.ts`**

`apps/orchestrator/src/adapters/run-store.ts`:
```typescript
import { eq, asc } from "drizzle-orm";
import { tasks, runs } from "@pi-harness/db";
import type { Task, TaskStatus, Run, Phase } from "@pi-harness/shared";
import { TASK_STATUSES } from "@pi-harness/shared";
import { NotFoundError } from "../domain/errors.js";

// db is the Drizzle instance returned by createDb(). We accept it as a generic
// to avoid binding the orchestrator to drizzle-orm's PgDatabase type literal.
export class RunStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: any) {}

  async createTask(input: { title: string; description?: string }): Promise<Task> {
    const [row] = await this.db
      .insert(tasks)
      .values({ title: input.title, description: input.description ?? "" })
      .returning();
    return row as Task;
  }

  async getTask(id: string): Promise<Task> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id));
    if (!row) throw new NotFoundError("task", id);
    return row as Task;
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const [row] = await this.db
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    if (!row) throw new NotFoundError("task", id);
    return row as Task;
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.updateTask(id, { status });
  }

  async listTasks(): Promise<Task[]> {
    const rows = await this.db.select().from(tasks).orderBy(asc(tasks.createdAt));
    return rows as Task[];
  }

  async listTasksByStatus(status: TaskStatus): Promise<Task[]> {
    const rows = await this.db.select().from(tasks).where(eq(tasks.status, status));
    return rows as Task[];
  }

  async countByStatus(): Promise<Record<TaskStatus, number>> {
    const rows = (await this.db.select().from(tasks)) as Task[];
    const init = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const t of rows) init[t.status]++;
    return init;
  }

  async createRun(input: { taskId: string; phase: Phase }): Promise<Run> {
    const [row] = await this.db
      .insert(runs)
      .values({ taskId: input.taskId, phase: input.phase })
      .returning();
    return row as Run;
  }

  async listRuns(taskId: string): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(asc(runs.startedAt));
    return rows as Run[];
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<Run> {
    const [row] = await this.db.update(runs).set(patch).where(eq(runs.id, id)).returning();
    if (!row) throw new NotFoundError("run", id);
    return row as Run;
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test run-store`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/adapters/run-store.ts apps/orchestrator/test/run-store.test.ts
git commit -m "feat(orchestrator): RunStore — task/run CRUD on Drizzle"
```

---

## Task 9: Adapter — `EventStore` with pub/sub

Persists events and broadcasts them in-process to subscribers (the SSE handler is the main subscriber). Postgres LISTEN/NOTIFY would also work but adds operational complexity for v1; in-memory pub/sub is fine for a single orchestrator instance.

**Files:**
- Create: `apps/orchestrator/src/adapters/event-store.ts`, `apps/orchestrator/test/event-store.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/event-store.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { EventStore } from "../src/adapters/event-store.js";
import { mkEvent } from "../src/domain/events.js";
import { RunStore } from "../src/adapters/run-store.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("EventStore", () => {
  const { db, client } = createDb(url);
  const events = new EventStore(db);
  const runs = new RunStore(db);

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
  });

  it("persists and lists events for a run", async () => {
    const t = await runs.createTask({ title: "events" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));
    await events.append(
      mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "ok" }),
    );

    const list = await events.listForRun(r.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.kind).toBe("phase_started");
  });

  it("notifies subscribers on append", async () => {
    const t = await runs.createTask({ title: "sub" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });

    const received: string[] = [];
    const unsub = events.subscribe(r.id, (e) => received.push(e.kind));

    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));
    await events.append(
      mkEvent({ runId: r.id, taskId: t.id, kind: "tool_call", tool: "Read", input: {} }),
    );

    expect(received).toEqual(["phase_started", "tool_call"]);
    unsub();
  });

  it("subscribers for one run do not see events from another", async () => {
    const t = await runs.createTask({ title: "iso" });
    const r1 = await runs.createRun({ taskId: t.id, phase: "code" });
    const r2 = await runs.createRun({ taskId: t.id, phase: "verify" });

    const r1got: string[] = [];
    events.subscribe(r1.id, (e) => r1got.push(e.kind));

    await events.append(
      mkEvent({ runId: r2.id, taskId: t.id, kind: "log", level: "info", text: "x" }),
    );

    expect(r1got).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test event-store`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/event-store.ts`**

`apps/orchestrator/src/adapters/event-store.ts`:
```typescript
import { eq, asc } from "drizzle-orm";
import { events as eventsTable } from "@pi-harness/db";
import type { AgentEvent } from "@pi-harness/shared";

type Subscriber = (e: AgentEvent) => void;

// Persists every AgentEvent to Postgres and pushes a copy to in-process
// subscribers. The SSE handler subscribes here; the dashboard "live log" is
// just a tail of these.
//
// Note: in-process pub/sub means a multi-instance deployment would miss events
// across replicas. v1 runs a single orchestrator. v2: pg LISTEN/NOTIFY or Redis.
export class EventStore {
  private readonly subs = new Map<string, Set<Subscriber>>(); // runId → subs

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: any) {}

  async append(e: AgentEvent): Promise<void> {
    // Map AgentEvent → row. The row stores `kind` and stuffs the rest into
    // `payload` JSONB so we don't need a column per event variant.
    const { id, runId, taskId, ts, kind, ...rest } = e as AgentEvent & Record<string, unknown>;
    await this.db.insert(eventsTable).values({
      id,
      runId,
      taskId,
      ts,
      kind,
      payload: rest,
    });

    const subs = this.subs.get(runId);
    if (subs) {
      for (const sub of subs) sub(e);
    }
  }

  async listForRun(runId: string): Promise<AgentEvent[]> {
    const rows = await this.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.runId, runId))
      .orderBy(asc(eventsTable.ts));
    return rows.map((r: { id: string; runId: string; taskId: string; ts: Date; kind: string; payload: Record<string, unknown> }) => ({
      id: r.id,
      runId: r.runId,
      taskId: r.taskId,
      ts: r.ts,
      kind: r.kind,
      ...r.payload,
    })) as AgentEvent[];
  }

  subscribe(runId: string, sub: Subscriber): () => void {
    let set = this.subs.get(runId);
    if (!set) {
      set = new Set();
      this.subs.set(runId, set);
    }
    set.add(sub);
    return () => {
      set!.delete(sub);
      if (set!.size === 0) this.subs.delete(runId);
    };
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test event-store`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/adapters/event-store.ts apps/orchestrator/test/event-store.test.ts
git commit -m "feat(orchestrator): EventStore with persist + in-proc pub/sub"
```

---

## Task 10: Adapter — `PiDispatcher`

Wraps `pi-bridge` to run a single phase. Translates `PiBridgeEvent` → `AgentEvent` and pushes through `EventStore`. Updates the run row with cost/tokens at end. The actual prompts for each phase are Plan 3's concern; here the dispatcher accepts a generic `phasePrompt` argument.

**Files:**
- Create: `apps/orchestrator/src/adapters/dispatcher.ts`, `apps/orchestrator/test/dispatcher.test.ts`

- [ ] **Step 1: Write failing test (uses mocked pi-bridge)**

`apps/orchestrator/test/dispatcher.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { PiDispatcher } from "../src/adapters/dispatcher.js";
import type { PiSession } from "@pi-harness/pi-bridge";

function mockSessionFactory() {
  const session: PiSession = {
    prompt: vi.fn(async () => ({
      finalText: "phase result",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    })),
    close: vi.fn(async () => {}),
  };
  return { session, createSession: vi.fn(async () => session) };
}

describe("PiDispatcher", () => {
  it("runs a phase and reports usage", async () => {
    const { createSession } = mockSessionFactory();
    const events: string[] = [];
    const eventStore = {
      append: vi.fn(async (e) => events.push(e.kind)),
    };

    const d = new PiDispatcher({
      createSession,
      eventStore,
    });

    const result = await d.runPhase({
      runId: "r1",
      taskId: "t1",
      phase: "code",
      cwd: "/tmp",
      systemPrompt: "you are coder",
      userMessage: "do the thing",
    });

    expect(result.ok).toBe(true);
    expect(result.costUsd).toBe(0.001);
    expect(result.inputTokens).toBe(100);
    expect(events).toContain("phase_started");
    expect(events).toContain("phase_ended");
  });

  it("emits phase_ended with status=failed when prompt throws", async () => {
    const failing: PiSession = {
      prompt: vi.fn(async () => {
        throw new Error("LLM exploded");
      }),
      close: vi.fn(async () => {}),
    };

    const events: { kind: string; status?: string }[] = [];
    const d = new PiDispatcher({
      createSession: async () => failing,
      eventStore: {
        append: async (e) => {
          events.push({ kind: e.kind, status: (e as { status?: string }).status });
        },
      },
    });

    const result = await d.runPhase({
      runId: "r1",
      taskId: "t1",
      phase: "code",
      cwd: "/tmp",
      systemPrompt: "x",
      userMessage: "y",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("LLM exploded");
    const ended = events.find((e) => e.kind === "phase_ended");
    expect(ended?.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test dispatcher`
Expected: FAIL.

- [ ] **Step 3: Implement `src/adapters/dispatcher.ts`**

`apps/orchestrator/src/adapters/dispatcher.ts`:
```typescript
import type { Phase } from "@pi-harness/shared";
import type {
  PiSession,
  PiSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { mkEvent } from "../domain/events.js";

export type DispatchOptions = {
  runId: string;
  taskId: string;
  phase: Phase;
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
};

export type DispatchResult = {
  ok: boolean;
  finalText?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
};

// Minimal interface the dispatcher needs from EventStore — accepting a
// structural type makes it trivially mockable in tests.
type EventSink = {
  append: (e: ReturnType<typeof mkEvent>) => Promise<void>;
};

type CreateSession = (opts: PiSessionOptions) => Promise<PiSession>;

// Runs one phase: creates a pi session, pumps prompt → result, translates pi
// events into AgentEvents, and records phase_started/phase_ended bookends.
//
// The actual phase prompts (system + user message) are passed in by the
// run-loop. Plan 3 will plug in the real prompts; this dispatcher is prompt-
// agnostic.
export class PiDispatcher {
  private readonly createSession: CreateSession;
  private readonly eventStore: EventSink;

  constructor(deps: { createSession: CreateSession; eventStore: EventSink }) {
    this.createSession = deps.createSession;
    this.eventStore = deps.eventStore;
  }

  async runPhase(opts: DispatchOptions): Promise<DispatchResult> {
    const { runId, taskId, phase, cwd, systemPrompt, userMessage, signal } = opts;

    await this.eventStore.append(
      mkEvent({ runId, taskId, kind: "phase_started", phase }),
    );

    const onEvent = (e: PiBridgeEvent) => {
      // Fire-and-forget; we don't want translation latency to block the LLM.
      void this.eventStore.append(this.translate(runId, taskId, e));
    };

    let session: PiSession | null = null;
    try {
      session = await this.createSession({ cwd, systemPrompt, signal, onEvent });
      const result = await session.prompt(userMessage);
      await this.eventStore.append(
        mkEvent({ runId, taskId, kind: "phase_ended", phase, status: "succeeded" }),
      );
      return {
        ok: true,
        finalText: result.finalText,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      };
    } catch (e) {
      const err = e as Error;
      await this.eventStore.append(
        mkEvent({ runId, taskId, kind: "phase_ended", phase, status: "failed" }),
      );
      return {
        ok: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error: err.message,
      };
    } finally {
      if (session) await session.close();
    }
  }

  private translate(runId: string, taskId: string, e: PiBridgeEvent) {
    switch (e.kind) {
      case "message_delta":
        return mkEvent({ runId, taskId, kind: "message_delta", text: e.text });
      case "tool_call":
        return mkEvent({ runId, taskId, kind: "tool_call", tool: e.tool, input: e.input });
      case "tool_result":
        return mkEvent({ runId, taskId, kind: "tool_result", tool: e.tool, ok: e.ok });
      case "log":
        return mkEvent({ runId, taskId, kind: "log", level: e.level, text: e.text });
    }
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test dispatcher`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/adapters/dispatcher.ts apps/orchestrator/test/dispatcher.test.ts
git commit -m "feat(orchestrator): PiDispatcher — pi-bridge → AgentEvent translation"
```

---

## Task 11: Runner — `runLoop`

Drives a task through its phase chain. Reads task → picks next phase → calls dispatcher → applies state-machine transition → loops. Stops on phase that requires human input (planning approval) or terminal state.

For Plan 2 the actual phase prompts are stubs ("[plan-3 will provide brainstorm prompt]"). Plan 3 replaces these with real prompts. The wiring is correct now so Plan 3 is a one-file diff.

**Files:**
- Create: `apps/orchestrator/src/runner/run-loop.ts`, `apps/orchestrator/src/runner/phase-prompts.ts`, `apps/orchestrator/test/run-loop.test.ts`

- [ ] **Step 1: Write failing test (uses mocked dispatcher)**

`apps/orchestrator/test/run-loop.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { runLoop } from "../src/runner/run-loop.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("runLoop", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
  });

  it("runs brainstorm → planning then halts for user approval", async () => {
    const t = await runs.createTask({ title: "loop" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    const dispatcher = {
      runPhase: vi.fn(async () => ({
        ok: true,
        finalText: "done",
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.0001,
      })),
    };

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      dispatcher,
      cwd: "/tmp",
      retryCap: 2,
    });

    expect(after.status).toBe("planning");
    expect(dispatcher.runPhase).toHaveBeenCalledTimes(1);
    expect(dispatcher.runPhase.mock.calls[0]![0]!.phase).toBe("brainstorm");
  });

  it("verify failure with retries left → executing, retryCount++", async () => {
    const t = await runs.createTask({ title: "fail" });
    await runs.updateTask(t.id, { status: "verifying", workflow: "backend-feature" });

    const dispatcher = {
      runPhase: vi.fn(async () => ({
        ok: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error: "scenario failed",
      })),
    };

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      dispatcher,
      cwd: "/tmp",
      retryCap: 2,
    });

    expect(after.status).toBe("executing");
    expect(after.retryCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test run-loop`
Expected: FAIL.

- [ ] **Step 3: Implement `src/runner/phase-prompts.ts`**

`apps/orchestrator/src/runner/phase-prompts.ts`:
```typescript
import type { Phase } from "@pi-harness/shared";

// Stub prompts. Plan 3 replaces these with the real Brainstorm/Plan/Code/Verify/PR
// prompt files. The orchestrator calls them through this single function.
export function getPromptFor(phase: Phase): { system: string; user: string } {
  switch (phase) {
    case "brainstorm":
      return {
        system: "[plan-3 will provide brainstorm system prompt]",
        user: "[plan-3 will provide brainstorm user message]",
      };
    case "plan":
      return {
        system: "[plan-3 will provide plan system prompt]",
        user: "[plan-3 will provide plan user message]",
      };
    case "code":
      return {
        system: "[plan-3 will provide code system prompt]",
        user: "[plan-3 will provide code user message]",
      };
    case "verify":
      return {
        system: "[plan-3 will provide verify system prompt]",
        user: "[plan-3 will provide verify user message]",
      };
    case "pr":
      return {
        system: "[plan-3 will provide pr system prompt]",
        user: "[plan-3 will provide pr user message]",
      };
  }
}
```

- [ ] **Step 4: Implement `src/runner/run-loop.ts`**

`apps/orchestrator/src/runner/run-loop.ts`:
```typescript
import type { Phase, Task } from "@pi-harness/shared";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import { transition } from "../domain/state-machine.js";
import { phasesFor } from "../domain/phase-chain.js";
import { getPromptFor } from "./phase-prompts.js";

// Minimal dispatcher interface — easier to mock than the concrete class.
type Dispatcher = {
  runPhase: (opts: {
    runId: string;
    taskId: string;
    phase: Phase;
    cwd: string;
    systemPrompt: string;
    userMessage: string;
  }) => Promise<{
    ok: boolean;
    finalText?: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    error?: string;
  }>;
};

export type RunLoopOpts = {
  task: Task;
  runs: RunStore;
  events: EventStore;
  dispatcher: Dispatcher;
  cwd: string;
  retryCap: number;
};

// Map current task.status → which Phase the next dispatch should be.
// Returns null when the task needs human input or is terminal.
function phaseToRun(status: Task["status"]): Phase | null {
  switch (status) {
    case "brainstorming": return "brainstorm";
    case "executing":     return "code";
    case "verifying":     return "verify";
    case "ready_to_ship": return "pr";
    case "planning":      return null; // user must approve plan
    case "verification_failed": return null; // user must triage
    case "backlog":
    case "done":
    case "cancelled":
      return null;
  }
}

// Drives the task through its phase chain. Each call advances at most one
// phase — it stops on completion, on a status that requires human input, or on
// failure. The orchestrator's main scheduler loops on this until the task is
// done or blocked.
export async function runLoop(opts: RunLoopOpts): Promise<Task> {
  const { runs, events, dispatcher, cwd, retryCap } = opts;
  let task = opts.task;

  if (!task.workflow) return task;
  // Touch phasesFor to validate the workflow has a chain (throws otherwise).
  phasesFor(task.workflow);

  const phase = phaseToRun(task.status);
  if (!phase) return task;

  const run = await runs.createRun({ taskId: task.id, phase });

  const prompt = getPromptFor(phase);
  const result = await dispatcher.runPhase({
    runId: run.id,
    taskId: task.id,
    phase,
    cwd,
    systemPrompt: prompt.system,
    userMessage: prompt.user,
  });

  await runs.updateRun(run.id, {
    endedAt: new Date(),
    status: result.ok ? "succeeded" : "failed",
    error: result.error ?? null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  });

  const nextResult = transition(
    task,
    result.ok
      ? { type: "agent_phase_succeeded", phase }
      : { type: "agent_phase_failed", phase, retryCap },
  );

  if (!nextResult.ok) {
    // Should never happen if state-machine and run-loop agree on shape.
    await events.append({
      id: crypto.randomUUID(),
      runId: run.id,
      taskId: task.id,
      ts: new Date(),
      kind: "log",
      level: "error",
      text: `state machine refused transition: ${nextResult.error.message}`,
    });
    return task;
  }

  task = await runs.updateTask(task.id, {
    status: nextResult.task.status,
    retryCount: nextResult.task.retryCount,
  });

  return task;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test run-loop`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/runner apps/orchestrator/test/run-loop.test.ts
git commit -m "feat(orchestrator): runLoop drives task through phase chain"
```

---

## Task 12: HTTP — Fastify server with task/run routes

Read-only routes first; transitions next. The dashboard mocks (`docs/mocks/`) determine the response shapes — every value in the mocks is a field here.

**Files:**
- Create: `apps/orchestrator/src/http/schemas.ts`, `apps/orchestrator/src/http/server.ts`, `apps/orchestrator/src/http/routes/health.ts`, `apps/orchestrator/src/http/routes/tasks.ts`, `apps/orchestrator/src/http/routes/runs.ts`, `apps/orchestrator/test/http.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/http.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { buildServer } from "../src/http/server.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("http", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const app = buildServer({ runs, events });

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("GET /healthz returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /api/tasks creates a task in backlog", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "from http", description: "x" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("backlog");
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("POST /api/tasks rejects empty title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/tasks lists with status counts", async () => {
    await runs.createTask({ title: "a" });
    await runs.createTask({ title: "b" });
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.counts.backlog).toBe(2);
  });

  it("POST /api/tasks/:id/transitions runs state-machine + persists", async () => {
    const t = await runs.createTask({ title: "trans" });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_start_brainstorm", workflow: "backend-feature" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.task.status).toBe("brainstorming");
    expect(body.task.workflow).toBe("backend-feature");
  });

  it("POST /api/tasks/:id/transitions rejects invalid transition with 409", async () => {
    const t = await runs.createTask({ title: "x" });
    await runs.updateTask(t.id, { status: "done" });
    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${t.id}/transitions`,
      payload: { type: "user_cancel" },
    });
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test http`
Expected: FAIL.

- [ ] **Step 3: Implement `src/http/schemas.ts`**

`apps/orchestrator/src/http/schemas.ts`:
```typescript
import { z } from "zod";
import { WORKFLOWS } from "@pi-harness/shared";

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
});

export const TransitionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_start_brainstorm"),
    workflow: z.enum(WORKFLOWS),
  }),
  z.object({ type: z.literal("user_approve_plan") }),
  z.object({ type: z.literal("user_approve_scenarios") }),
  z.object({ type: z.literal("user_cancel") }),
  z.object({ type: z.literal("user_retry_failed") }),
]);
```

- [ ] **Step 4: Implement `src/http/routes/health.ts`**

`apps/orchestrator/src/http/routes/health.ts`:
```typescript
import type { FastifyInstance } from "fastify";

export function registerHealth(app: FastifyInstance): void {
  app.get("/healthz", async () => ({ ok: true }));
}
```

- [ ] **Step 5: Implement `src/http/routes/tasks.ts`**

`apps/orchestrator/src/http/routes/tasks.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { RunStore } from "../../adapters/run-store.js";
import { transition } from "../../domain/state-machine.js";
import { CreateTaskSchema, TransitionSchema } from "../schemas.js";
import { isHarnessError, ValidationError } from "../../domain/errors.js";

export function registerTaskRoutes(app: FastifyInstance, deps: { runs: RunStore }): void {
  const { runs } = deps;

  app.get("/api/tasks", async () => {
    const [tasks, counts] = await Promise.all([runs.listTasks(), runs.countByStatus()]);
    return { tasks, counts };
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
    const task = await runs.getTask(req.params.id);
    const taskRuns = await runs.listRuns(task.id);
    return { task, runs: taskRuns };
  });

  app.post("/api/tasks", async (req, reply) => {
    let parsed;
    try {
      parsed = CreateTaskSchema.parse(req.body);
    } catch (e) {
      if (e instanceof ZodError) throw new ValidationError("invalid task body", { issues: e.issues });
      throw e;
    }
    const t = await runs.createTask(parsed);
    reply.code(201);
    return t;
  });

  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/transitions",
    async (req, reply) => {
      let action;
      try {
        action = TransitionSchema.parse(req.body);
      } catch (e) {
        if (e instanceof ZodError) throw new ValidationError("invalid action", { issues: e.issues });
        throw e;
      }

      const task = await runs.getTask(req.params.id);
      const result = transition(task, action);
      if (!result.ok) {
        reply.code(result.error.status);
        return {
          error: result.error.code,
          message: result.error.message,
          details: result.error.details,
        };
      }
      const updated = await runs.updateTask(task.id, {
        status: result.task.status,
        workflow: result.task.workflow,
        retryCount: result.task.retryCount,
      });
      return { task: updated };
    },
  );

  // Centralized error handling — turns HarnessError into the right status.
  app.setErrorHandler((err, _req, reply) => {
    if (isHarnessError(err)) {
      reply.code(err.status);
      return reply.send({ error: err.code, message: err.message, details: err.details });
    }
    reply.code(500);
    return reply.send({ error: "internal", message: err.message });
  });
}
```

- [ ] **Step 6: Implement `src/http/routes/runs.ts`**

`apps/orchestrator/src/http/routes/runs.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import type { RunStore } from "../../adapters/run-store.js";
import type { EventStore } from "../../adapters/event-store.js";

export function registerRunRoutes(
  app: FastifyInstance,
  deps: { runs: RunStore; events: EventStore },
): void {
  const { events } = deps;

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (req) => {
    return { events: await events.listForRun(req.params.id) };
  });
}
```

- [ ] **Step 7: Implement `src/http/server.ts`**

`apps/orchestrator/src/http/server.ts`:
```typescript
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { RunStore } from "../adapters/run-store.js";
import type { EventStore } from "../adapters/event-store.js";
import { registerHealth } from "./routes/health.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerRunRoutes } from "./routes/runs.js";

export type ServerDeps = {
  runs: RunStore;
  events: EventStore;
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: { level: "warn" } });
  // CORS so the Next.js dashboard (Plan 4) can call us in dev.
  void app.register(cors, { origin: true });
  registerHealth(app);
  registerTaskRoutes(app, { runs: deps.runs });
  registerRunRoutes(app, { runs: deps.runs, events: deps.events });
  return app;
}
```

- [ ] **Step 8: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test http`
Expected: PASS — 6 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/orchestrator/src/http apps/orchestrator/test/http.test.ts
git commit -m "feat(orchestrator): HTTP API — tasks/runs + transition endpoint"
```

---

## Task 13: HTTP — SSE events route

Subscribes to `EventStore` for a given runId and streams as SSE. The Task Detail mock's "Agent Log · live (SSE)" box is the consumer.

**Files:**
- Create: `apps/orchestrator/src/http/routes/events.ts`, `apps/orchestrator/test/sse.test.ts`
- Modify: `apps/orchestrator/src/http/server.ts`

- [ ] **Step 1: Write failing test (real HTTP server, real client)**

`apps/orchestrator/test/sse.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { buildServer } from "../src/http/server.js";
import { mkEvent } from "../src/domain/events.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("SSE /api/runs/:id/events/stream", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  const app = buildServer({ runs, events });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
  });

  it("streams existing + new events, ends on close", async () => {
    const t = await runs.createTask({ title: "sse" });
    const r = await runs.createRun({ taskId: t.id, phase: "code" });
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "phase_started", phase: "code" }));

    await app.listen({ port: 0 });
    const port = (app.server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${r.id}/events/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // Read replayed event.
    const first = await reader.read();
    buf += decoder.decode(first.value);
    expect(buf).toContain('"kind":"phase_started"');

    // Append a new event and verify it streams.
    await events.append(mkEvent({ runId: r.id, taskId: t.id, kind: "log", level: "info", text: "hi" }));

    // Read until we see the new event (loop with a small budget).
    const start = Date.now();
    while (!buf.includes('"text":"hi"') && Date.now() - start < 2000) {
      const next = await reader.read();
      if (next.value) buf += decoder.decode(next.value);
      if (next.done) break;
    }
    expect(buf).toContain('"text":"hi"');

    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test sse`
Expected: FAIL.

- [ ] **Step 3: Implement `src/http/routes/events.ts`**

`apps/orchestrator/src/http/routes/events.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import type { AgentEvent } from "@pi-harness/shared";
import type { EventStore } from "../../adapters/event-store.js";

export function registerEventStream(
  app: FastifyInstance,
  deps: { events: EventStore },
): void {
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/events/stream",
    async (req, reply) => {
      const runId = req.params.id;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (e: AgentEvent) => {
        reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
      };

      // Replay everything we have, then subscribe.
      // (Race: events appended between listForRun and subscribe could be missed.
      // For v1 this is acceptable; v2 can switch to a SQL cursor for ordering.)
      const existing = await deps.events.listForRun(runId);
      for (const e of existing) send(e);

      const unsub = deps.events.subscribe(runId, send);

      req.raw.on("close", () => {
        unsub();
        reply.raw.end();
      });

      // Keep the response open.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return new Promise<never>(() => {});
    },
  );
}
```

- [ ] **Step 4: Wire it into `server.ts`**

Edit `apps/orchestrator/src/http/server.ts` — add import and registration:
```typescript
import { registerEventStream } from "./routes/events.js";
// ...inside buildServer, after registerRunRoutes:
registerEventStream(app, { events: deps.events });
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test sse`
Expected: PASS — 1 test.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/http/routes/events.ts apps/orchestrator/src/http/server.ts apps/orchestrator/test/sse.test.ts
git commit -m "feat(orchestrator): SSE event stream per run"
```

---

## Task 14: Janitor — reconcile worktrees on boot

On orchestrator startup: list git worktrees, list tasks in non-terminal states, log + clean orphans. Spec §13 risk #5 (worktree leakage).

**Files:**
- Create: `apps/orchestrator/src/runner/janitor.ts`, `apps/orchestrator/test/janitor.test.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/janitor.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { reconcileWorktrees } from "../src/runner/janitor.js";

describe("reconcileWorktrees", () => {
  it("removes worktrees whose taskId is not in the active set", async () => {
    const removed: string[] = [];
    const wm = {
      list: vi.fn(async () => [
        { taskId: "active-1", path: "/x/a1", branch: "feat/a1" },
        { taskId: "orphan-9", path: "/x/o9", branch: "feat/o9" },
      ]),
      remove: vi.fn(async (id: string) => {
        removed.push(id);
      }),
    };

    const report = await reconcileWorktrees({
      worktreeManager: wm,
      activeTaskIds: new Set(["active-1"]),
    });

    expect(removed).toEqual(["orphan-9"]);
    expect(report.removed).toEqual(["orphan-9"]);
    expect(report.kept).toEqual(["active-1"]);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test janitor`
Expected: FAIL.

- [ ] **Step 3: Implement `src/runner/janitor.ts`**

`apps/orchestrator/src/runner/janitor.ts`:
```typescript
type WorktreeManagerLike = {
  list: () => Promise<{ taskId: string; path: string; branch: string }[]>;
  remove: (taskId: string) => Promise<void>;
};

export type ReconcileReport = {
  kept: string[];
  removed: string[];
};

// Walks all on-disk worktrees and removes any whose task is no longer active
// (terminal status or missing entirely). Run this at orchestrator boot.
export async function reconcileWorktrees(opts: {
  worktreeManager: WorktreeManagerLike;
  activeTaskIds: Set<string>;
}): Promise<ReconcileReport> {
  const present = await opts.worktreeManager.list();
  const kept: string[] = [];
  const removed: string[] = [];
  for (const wt of present) {
    if (opts.activeTaskIds.has(wt.taskId)) {
      kept.push(wt.taskId);
    } else {
      await opts.worktreeManager.remove(wt.taskId);
      removed.push(wt.taskId);
    }
  }
  return { kept, removed };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test janitor`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add apps/orchestrator/src/runner/janitor.ts apps/orchestrator/test/janitor.test.ts
git commit -m "feat(orchestrator): worktree janitor"
```

---

## Task 15: Wire `src/index.ts` — boot the service

Pulls the pieces together into a runnable service. Loads config → creates db client → constructs adapters → builds server → calls janitor → listens on port.

**Files:**
- Modify: `apps/orchestrator/src/index.ts`

- [ ] **Step 1: Replace `src/index.ts`**

`apps/orchestrator/src/index.ts`:
```typescript
import { createDb } from "@pi-harness/db";
import { loadConfig } from "./config.js";
import { RunStore } from "./adapters/run-store.js";
import { EventStore } from "./adapters/event-store.js";
import { WorktreeManager } from "./adapters/worktree.js";
import { reconcileWorktrees } from "./runner/janitor.js";
import { buildServer } from "./http/server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { db } = createDb(config.databaseUrl);

  const runs = new RunStore(db);
  const events = new EventStore(db);
  const worktrees = new WorktreeManager({
    repoRoot: config.repoRoot,
    worktreesDir: config.worktreesDir,
  });

  const allTasks = await runs.listTasks();
  const activeIds = new Set(
    allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled").map((t) => t.id),
  );
  const report = await reconcileWorktrees({ worktreeManager: worktrees, activeTaskIds: activeIds });
  // eslint-disable-next-line no-console
  console.log(`[janitor] kept=${report.kept.length} removed=${report.removed.length}`);

  const app = buildServer({ runs, events });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[orchestrator] listening on :${config.port}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @pi-harness/orchestrator build`
Expected: clean.

- [ ] **Step 3: Smoke-start**

Run: `pnpm --filter @pi-harness/orchestrator dev` (in one terminal). Then in another:
```bash
curl -s http://localhost:4000/healthz
```
Expected: `{"ok":true}`.

Run:
```bash
curl -s -X POST http://localhost:4000/api/tasks -H 'content-type: application/json' -d '{"title":"first task"}'
```
Expected: 201, JSON with `status: "backlog"` and a UUID.

Run:
```bash
curl -s http://localhost:4000/api/tasks
```
Expected: JSON `{ tasks: [...], counts: { backlog: 1, ... } }`.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/orchestrator/src/index.ts
git commit -m "feat(orchestrator): wire boot — db + adapters + janitor + http"
```

---

## Task 16: Smoke verification — all tests + cross-package

The end-of-plan gate. Every test we wrote in Plan 1 + Plan 2 should still pass.

- [ ] **Step 1: Full install**

Run: `pnpm install`
Expected: clean.

- [ ] **Step 2: Typecheck everything**

Run: `pnpm typecheck`
Expected: clean across all workspaces.

- [ ] **Step 3: Build everything**

Run: `pnpm build`
Expected: every package builds.

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected output (Plan 1 + Plan 2 tests combined):
- `@pi-harness/shared`: 4 passed
- `@pi-harness/db`: 2 passed
- `@pi-harness/pi-bridge`: 1 passed
- `@pi-harness/subagents`: 3 passed
- `@pi-harness/orchestrator`: ~30 passed (errors:4, phase-chain:5, state-machine:9, events:3, worktree:3, run-store:4, event-store:3, dispatcher:2, run-loop:2, http:6, sse:1, janitor:1)

Total ~40 tests.

If any test fails, **stop and fix before moving to Plan 3.**

- [ ] **Step 5: Tag the milestone**

```bash
git tag plan-2-orchestrator-complete
```

---

## Self-Review

**Spec coverage**

| Spec section | Plan task |
|---|---|
| §3 architecture (orchestrator owns state machine + dispatch + events) | Tasks 5, 8, 9, 10, 11 |
| §4 kanban states + transitions | Task 5 (state machine) |
| §5 worktree-per-task | Task 7 (WorktreeManager) |
| §6 workflow router (single workflow) | Task 4 (phase chain) |
| §8.3 hard-fail with retry cap | Task 5 (`agent_phase_failed` rule), Task 11 (retryCap pass-through) |
| §10.1/§10.2 dashboard SSE | Task 13 |
| §13 risk #5 (worktree leakage) | Task 14 (janitor) |

**Mock coverage**

| Mock element | Backed by |
|---|---|
| `kanban.html` page-head counts (`15 tasks · 4 in flight · 1 awaiting human`) | `RunStore.countByStatus` (Task 8) |
| `task-detail.html` worktree path + branch + commit count | `WorktreeManager.list` + git log (commit count is computed on demand) |
| `task-detail.html` SSE log | `/api/runs/:id/events/stream` (Task 13) |
| `task-detail.html` cost · tokens | `Run.costUsd / inputTokens / outputTokens` (updated by dispatcher → run-store, Task 10/11) |
| `task-detail.html` files changed | (deferred — Plan 3 derives from `tool_call`/`tool_result` events) |
| `task-detail.html` retry counter, phase budget | `Task.retryCount`, run cost vs config budget (config.ts has the cap) |
| `verification.html` 24/24 unit, 3/3 functional | (deferred — Plan 3, Verifier Agent writes to `artifacts` table) |

**Type consistency**

- `Phase` and `Workflow` come from `@pi-harness/shared` everywhere. Phase chain, state machine, run-loop, prompts all import the same alias.
- `AgentEvent` discriminated union from shared is the only event shape — dispatcher translates pi-bridge events into this; SSE serializes this; events table stores `kind` + `payload` JSONB.
- `Task` and `Run` are returned from `RunStore` and consumed by routes/run-loop without re-mapping.

**Placeholder scan**

- `phase-prompts.ts` has explicit `[plan-3 will provide …]` literals — these are the *intended* handoff points, not placeholders to fix in Plan 2.
- No "TODO" / "TBD" comments in the implementation files.

**Plan 2 → Plan 3 handoff**

Plan 3 needs to:
1. Replace `phase-prompts.ts` returns with the real Brainstorm/Plan/Code/Verify/PR system+user prompts.
2. Add the agent-fleet-author subagents (`verification-author`, `proof-capture`, `screenshot-taker`) to `subagents/ours/`.
3. Wire the planner's pipeline (phase 1–7 from spec §7.1) inside the `plan` phase prompt logic.
4. Wire the verifier's scenario-runner inside the `verify` phase logic.

**Plan 2 → Plan 4 handoff**

Plan 4 (dashboard) consumes:
- `GET /api/tasks` → returns `{ tasks, counts }` for the kanban
- `GET /api/tasks/:id` → returns `{ task, runs }` for the detail page
- `GET /api/runs/:id/events` → returns the historical event log
- `GET /api/runs/:id/events/stream` → SSE for live tail
- `POST /api/tasks` → create
- `POST /api/tasks/:id/transitions` → user actions (start brainstorm, approve plan, cancel, retry)

The HTTP shapes match the mock fields 1:1 — every density-rule value (`4 in flight`, `task 4 of 9`, branch name, retry count, cost, tokens) is in the response.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-pi-harness-02-orchestrator.md`.**

This plan assumes Plan 1 has been executed (foundation packages exist + Postgres is running). Proceed via subagent-driven-development:
- Tasks 1–6 are pure / fast.
- Tasks 7–10 hit real Postgres + real git — make sure docker-compose is up before dispatching.
- Tasks 12–13 spin up Fastify; smoke-test with curl during review.
- Task 16 is the gate before Plan 3.
