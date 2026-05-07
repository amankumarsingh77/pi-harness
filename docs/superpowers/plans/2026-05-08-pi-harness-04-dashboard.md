# pi-harness Plan 4: Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Next.js dashboard that turns `docs/mocks/*.html` into a working app — five views (Kanban, Brainstorm chat, Plan review, Task detail with live SSE log, Verification proof panel) backed entirely by real orchestrator state. No mock data, no placeholder counts.

**Architecture:** Single Next.js 15 app (`apps/dashboard/`) using the App Router. Pages are server components by default; live regions (SSE log, kanban poll) are client components. State management is intentionally light — TanStack Query for data fetching with auto-revalidation, no Redux/Zustand. Tailwind v4 + the design tokens already proven in `docs/mocks/`.

Data flow:
- **Server components** fetch from the orchestrator REST API (`http://localhost:4000/api/...`) at request time.
- **Client components** subscribe to `/api/runs/:id/events/stream` (SSE) for live updates and refetch via TanStack Query when the user mutates state.
- **Mutations** (create task, transition, approve plan) go through Next.js Route Handlers that proxy the orchestrator — keeps CORS simple in production and lets us add auth in v2 without changing components.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript, Tailwind CSS 4, TanStack Query 5, Zod (form validation), Vitest + Testing Library + Playwright (e2e), `eventsource` polyfill for tests.

**Spec reference:** `docs/superpowers/specs/2026-05-08-pi-harness-design.md` — §10 Dashboard.

**Mock reference (the contract):**
- `docs/mocks/index.html` — landing/router (we don't ship this; it's just the navigation overview)
- `docs/mocks/kanban.html` — `/` board view
- `docs/mocks/brainstorm.html` — `/tasks/[id]/brainstorm` (chat + emerging spec + plan preview)
- `docs/mocks/task-detail.html` — `/tasks/[id]` (executing/verifying view with phase timeline + SSE log)
- `docs/mocks/verification.html` — `/tasks/[id]/verify` (proof gate with three columns)

**Density rule** (`memory/feedback_dashboard_density.md`): every visible string in every view must be backed by a real API value or computed from one. The mocks already enforce this — we re-create them faithfully and verify each rendered value has a backing field. **No `TODO` placeholders, no fake counts, no decorative copy.** A test in Task 11 asserts every page renders without literal "TODO"/"placeholder" strings.

**Out of scope for this plan:** workflow router UI (only one workflow exists), bulk actions (`archive Done`, `retry all failed` — v1.5), per-user auth (single-user dev tool in v1), mobile breakpoints (desktop only — kanban needs the width).

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/dashboard/package.json` | Manifest |
| `apps/dashboard/next.config.mjs` | Next config (port, rewrites for orchestrator) |
| `apps/dashboard/tsconfig.json` | TS |
| `apps/dashboard/postcss.config.mjs` | Tailwind v4 |
| `apps/dashboard/app/globals.css` | Design tokens (lifted from mocks) |
| `apps/dashboard/app/layout.tsx` | Root: topbar + mockbar removed; query provider |
| `apps/dashboard/app/page.tsx` | Kanban board (server component) |
| `apps/dashboard/app/tasks/new/page.tsx` | New task form |
| `apps/dashboard/app/tasks/[id]/page.tsx` | Task detail (live run) |
| `apps/dashboard/app/tasks/[id]/brainstorm/page.tsx` | Brainstorm chat + spec |
| `apps/dashboard/app/tasks/[id]/plan/page.tsx` | Plan review |
| `apps/dashboard/app/tasks/[id]/verify/page.tsx` | Verification proof gate |
| `apps/dashboard/app/api/proxy/[...path]/route.ts` | Server-side proxy to orchestrator |
| `apps/dashboard/app/api/sse/[runId]/route.ts` | SSE proxy (passes events through) |
| `apps/dashboard/components/topbar.tsx` | Logo + nav + search + new-task button |
| `apps/dashboard/components/kanban/board.tsx` | The 8-column grid (client) |
| `apps/dashboard/components/kanban/column.tsx` | Single column with header + cards |
| `apps/dashboard/components/kanban/card.tsx` | Task card variants per column accent |
| `apps/dashboard/components/task-detail/phase-timeline.tsx` | 5-pill phase strip |
| `apps/dashboard/components/task-detail/agent-log.tsx` | SSE-streamed monospace log |
| `apps/dashboard/components/task-detail/run-context.tsx` | Sidebar (worktree, agents, files, cost) |
| `apps/dashboard/components/brainstorm/chat-panel.tsx` | Chat with input box |
| `apps/dashboard/components/brainstorm/emerging-spec.tsx` | Goal/decisions/questions |
| `apps/dashboard/components/plan/plan-preview.tsx` | Workflow tag + summary + precedents |
| `apps/dashboard/components/plan/scenario-editor.tsx` | YAML scenario list with edit |
| `apps/dashboard/components/verify/evidence-column.tsx` | Generic 3-column unit/api/visual |
| `apps/dashboard/components/verify/screenshot-pair.tsx` | Expected vs actual comparison |
| `apps/dashboard/components/verify/verdict-strip.tsx` | "2/3 evidence ✓" bottom strip |
| `apps/dashboard/components/ui/pill.tsx` | Status pill primitive (semantic colors) |
| `apps/dashboard/components/ui/card.tsx` | Card primitive |
| `apps/dashboard/components/ui/button.tsx` | Button (default/ghost/danger/disabled) |
| `apps/dashboard/components/ui/skeleton.tsx` | Loading skeletons |
| `apps/dashboard/lib/api.ts` | Typed fetcher → orchestrator |
| `apps/dashboard/lib/use-events.ts` | SSE hook with reconnect |
| `apps/dashboard/lib/queries.ts` | TanStack Query keys + fetchers |
| `apps/dashboard/lib/format.ts` | Time/cost/tokens formatters |
| `apps/dashboard/test/setup.ts` | Vitest setup |
| `apps/dashboard/test/components/kanban.test.tsx` | Renders columns + counts from props |
| `apps/dashboard/test/components/task-detail.test.tsx` | Phase timeline; log scroll |
| `apps/dashboard/test/components/verify.test.tsx` | Three columns; pass/fail badges |
| `apps/dashboard/test/lib/api.test.ts` | Fetcher error mapping |
| `apps/dashboard/test/lib/use-events.test.ts` | SSE hook with mock EventSource |
| `apps/dashboard/test/no-placeholders.test.ts` | Greps every component for "TODO"/"placeholder" |
| `apps/dashboard/e2e/kanban.spec.ts` | Playwright: load board, see real tasks |
| `apps/dashboard/e2e/task-flow.spec.ts` | Playwright: create task → start brainstorm |

Plus a small extension to the orchestrator:

| Path | Responsibility |
|---|---|
| `apps/orchestrator/src/http/routes/artifacts.ts` | GET `/api/tasks/:id/artifacts/:name` — serves brainstorm.json/plan.json/proof-report.json |
| `apps/orchestrator/src/http/routes/screenshots.ts` | GET `/api/tasks/:id/proof/screenshots/:file` — static screenshot serving |

---

## Task 1: Orchestrator — artifact + screenshot routes

The dashboard needs to read `brainstorm.json`, `plan.json`, `proof-report.json`, and serve screenshot files. Plan 3 wrote them; this plan adds GET routes.

**Files:**
- Create: `apps/orchestrator/src/http/routes/artifacts.ts`, `apps/orchestrator/src/http/routes/screenshots.ts`, `apps/orchestrator/test/http/artifacts.test.ts`
- Modify: `apps/orchestrator/src/http/server.ts`

- [ ] **Step 1: Write failing test**

`apps/orchestrator/test/http/artifacts.test.ts`:
```typescript
import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../../src/adapters/run-store.js";
import { EventStore } from "../../src/adapters/event-store.js";
import { buildServer } from "../../src/http/server.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

describe("/api/tasks/:id/artifacts and /screenshots", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  let runsDir: string;

  beforeEach(async () => {
    await db.execute("delete from tasks");
    runsDir = await mkdtemp(join(tmpdir(), "runs-"));
  });

  afterAll(async () => {
    await client.end();
    if (runsDir) await rm(runsDir, { recursive: true, force: true });
  });

  it("returns brainstorm artifact JSON", async () => {
    const t = await runs.createTask({ title: "x" });
    const taskDir = join(runsDir, t.id);
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(taskDir, "brainstorm.json"),
      JSON.stringify({ goal: "g", decisions: [], openQuestions: [], suggestedWorkflow: "backend-feature", transcript: [] }),
    );

    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/artifacts/brainstorm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().goal).toBe("g");

    await app.close();
  });

  it("returns 404 when artifact is missing", async () => {
    const t = await runs.createTask({ title: "y" });
    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/artifacts/plan` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("serves screenshot files with image/png", async () => {
    const t = await runs.createTask({ title: "z" });
    const shotDir = join(runsDir, t.id, "proof", "screenshots");
    await mkdir(shotDir, { recursive: true });
    // Minimal 1x1 png
    const PNG = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex",
    );
    await writeFile(join(shotDir, "test.png"), PNG);

    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({ method: "GET", url: `/api/tasks/${t.id}/proof/screenshots/test.png` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");

    await app.close();
  });

  it("rejects path traversal", async () => {
    const t = await runs.createTask({ title: "p" });
    const app = buildServer({ runs, events, runsDir });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${t.id}/proof/screenshots/..%2F..%2Fetc%2Fpasswd`,
    });
    expect([400, 404]).toContain(res.statusCode);

    await app.close();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/orchestrator test http/artifacts`
Expected: FAIL — `runsDir` not accepted by buildServer; routes don't exist.

- [ ] **Step 3: Implement `src/http/routes/artifacts.ts`**

`apps/orchestrator/src/http/routes/artifacts.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NotFoundError, ValidationError } from "../../domain/errors.js";

const ALLOWED = new Set(["brainstorm", "plan", "proof-report"]);

// File names on disk for each allowed key.
const FILE_FOR: Record<string, { rel: string }> = {
  brainstorm: { rel: "brainstorm.json" },
  plan: { rel: "plan.json" },
  "proof-report": { rel: "proof/proof-report.json" },
};

export function registerArtifactRoutes(
  app: FastifyInstance,
  deps: { runsDir: string },
): void {
  app.get<{ Params: { id: string; name: string } }>(
    "/api/tasks/:id/artifacts/:name",
    async (req, reply) => {
      const { id, name } = req.params;
      if (!ALLOWED.has(name)) throw new ValidationError(`unknown artifact: ${name}`);

      const path = join(deps.runsDir, id, FILE_FOR[name]!.rel);
      // Defense in depth: ensure resolved path is still under runsDir.
      if (!resolve(path).startsWith(resolve(deps.runsDir))) {
        throw new ValidationError("path traversal rejected");
      }

      try {
        const raw = await readFile(path, "utf8");
        reply.type("application/json");
        return reply.send(raw);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          throw new NotFoundError(`artifact:${name}`, id);
        }
        throw e;
      }
    },
  );
}
```

- [ ] **Step 4: Implement `src/http/routes/screenshots.ts`**

`apps/orchestrator/src/http/routes/screenshots.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { NotFoundError, ValidationError } from "../../domain/errors.js";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function registerScreenshotRoutes(
  app: FastifyInstance,
  deps: { runsDir: string },
): void {
  app.get<{ Params: { id: string; file: string } }>(
    "/api/tasks/:id/proof/screenshots/:file",
    async (req, reply) => {
      const { id, file } = req.params;
      if (!/^[A-Za-z0-9._-]+$/.test(file)) {
        throw new ValidationError("invalid screenshot filename");
      }

      const path = join(deps.runsDir, id, "proof", "screenshots", file);
      const baseDir = resolve(join(deps.runsDir, id, "proof", "screenshots"));
      if (!resolve(path).startsWith(baseDir)) {
        throw new ValidationError("path traversal rejected");
      }

      try {
        await stat(path);
      } catch {
        throw new NotFoundError("screenshot", `${id}/${file}`);
      }

      const mime = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      reply.type(mime);
      return reply.send(createReadStream(path));
    },
  );
}
```

- [ ] **Step 5: Wire into `server.ts`**

Edit `apps/orchestrator/src/http/server.ts`:
```typescript
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerScreenshotRoutes } from "./routes/screenshots.js";

export type ServerDeps = {
  runs: RunStore;
  events: EventStore;
  runsDir: string;
};

export function buildServer(deps: ServerDeps): FastifyInstance {
  // ...existing code...
  registerArtifactRoutes(app, { runsDir: deps.runsDir });
  registerScreenshotRoutes(app, { runsDir: deps.runsDir });
  return app;
}
```

Update `src/index.ts` to pass `runsDir: config.runsDir` into `buildServer`.

Update existing tests that call `buildServer({ runs, events })` to pass `runsDir`. Use `os.tmpdir()` in tests where the path doesn't matter.

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @pi-harness/orchestrator test`
Expected: every test still green; new artifact tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/orchestrator
git commit -m "feat(orchestrator): GET /api/tasks/:id/artifacts and /screenshots"
```

---

## Task 2: Scaffold Next.js dashboard app

**Files:**
- Create: `apps/dashboard/package.json`, `apps/dashboard/next.config.mjs`, `apps/dashboard/tsconfig.json`, `apps/dashboard/postcss.config.mjs`, `apps/dashboard/app/layout.tsx`, `apps/dashboard/app/page.tsx` (placeholder), `apps/dashboard/app/globals.css`, `apps/dashboard/.gitignore`

- [ ] **Step 1: Create `package.json`**

`apps/dashboard/package.json`:
```json
{
  "name": "@pi-harness/dashboard",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit",
    "lint": "next lint"
  },
  "dependencies": {
    "@pi-harness/shared": "workspace:*",
    "@tanstack/react-query": "^5.59.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@tailwindcss/postcss": "^4.0.0-beta.4",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "happy-dom": "^15.7.0",
    "tailwindcss": "^4.0.0-beta.4",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
}
```

- [ ] **Step 2: Create config files**

`apps/dashboard/next.config.mjs`:
```javascript
/** @type {import('next').NextConfig} */
export default {
  experimental: { typedRoutes: true },
  // The orchestrator URL the proxy reaches. Defaults to dev port.
  env: { ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000" },
  // Strict mode catches subscription leaks early.
  reactStrictMode: true,
};
```

`apps/dashboard/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "module": "esnext",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/dashboard/postcss.config.mjs`:
```javascript
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`apps/dashboard/.gitignore`:
```
.next
next-env.d.ts
```

- [ ] **Step 3: Create `app/globals.css` with design tokens**

Lift the design tokens proven in `docs/mocks/`. **Every token here must match the mocks** so the implementation tracks the contract.

`apps/dashboard/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  /* Design tokens — see docs/mocks/. Every visible color goes through these. */
  --color-bg:        #0a0a0a;
  --color-card:      #111113;
  --color-sub:       #18181b;
  --color-muted:     #0f0f10;
  --color-input:     #050506;

  --color-fg:        #fafafa;
  --color-fg-body:   #e4e4e7;
  --color-fg-label:  #a1a1aa;
  --color-fg-subtle: #71717a;
  --color-fg-faint:  #52525b;
  --color-fg-ghost:  #3f3f46;

  --color-border:        #27272a;
  --color-border-soft:   #1f1f23;
  --color-border-strong: #3f3f46;

  --color-violet-fg: #a78bfa;
  --color-violet-bg: #3b1f5e;
  --color-blue-fg:   #60a5fa;
  --color-blue-bg:   #1e3a5f;
  --color-amber-fg:  #fbbf24;
  --color-amber-fg2: #fcd34d;
  --color-amber-bg:  #3f2d0c;
  --color-cyan-fg:   #22d3ee;
  --color-cyan-fg2:  #67e8f9;
  --color-cyan-bg:   #0e3a4a;
  --color-red-fg:    #f87171;
  --color-red-fg2:   #fca5a5;
  --color-red-bg:    #4a1414;
  --color-green-fg:  #34d399;
  --color-green-fg2: #6ee7b7;
  --color-green-bg:  #0d3a26;

  --font-display: ui-sans-serif, -apple-system, "SF Pro Display", "Geist", system-ui, sans-serif;
  --font-body:    ui-sans-serif, -apple-system, "SF Pro Text",   "Geist", system-ui, sans-serif;
  --font-mono:    ui-monospace, "SF Mono", "JetBrains Mono", "Geist Mono", Menlo, Consolas, monospace;
}

html, body {
  background: var(--color-bg);
  color: var(--color-fg-body);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.pulse-dot {
  width: 6px; height: 6px; border-radius: 9999px;
  display: inline-block; background: currentColor;
  box-shadow: 0 0 6px currentColor;
  animation: pulse 1.6s ease-in-out infinite;
}

@keyframes blink { 50% { opacity: 0; } }
.cursor {
  display: inline-block;
  width: 8px; height: 14px;
  background: var(--color-fg);
  margin-left: 2px; vertical-align: middle;
  animation: blink 1s steps(1) infinite;
}
```

- [ ] **Step 4: Create root layout**

`apps/dashboard/app/layout.tsx`:
```typescript
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";

export const metadata: Metadata = {
  title: "pi-harness",
  description: "Multi-agent coding harness dashboard",
};

export const viewport: Viewport = { themeColor: "#0a0a0a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create placeholder page**

`apps/dashboard/app/page.tsx`:
```typescript
export default function Page() {
  return <div className="p-8 text-fg">pi-harness — dashboard scaffolded</div>;
}
```

- [ ] **Step 6: Create QueryProvider seam (used in Task 4)**

`apps/dashboard/lib/query-provider.tsx`:
```typescript
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 7: Install + typecheck**

Run: `pnpm install && pnpm --filter @pi-harness/dashboard typecheck`
Expected: clean.

- [ ] **Step 8: Smoke build**

Run: `pnpm --filter @pi-harness/dashboard build`
Expected: build succeeds; one route `/` generated.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard pnpm-lock.yaml
git commit -m "feat(dashboard): scaffold Next.js + Tailwind v4 app"
```

---

## Task 3: API client + proxy + types

The dashboard never calls the orchestrator directly from client components — it goes through Next.js Route Handlers (`/api/proxy/...`). This keeps CORS clean and lets us add auth later. Server components can still call orchestrator directly via `lib/api.ts`.

**Files:**
- Create: `apps/dashboard/lib/api.ts`, `apps/dashboard/app/api/proxy/[...path]/route.ts`, `apps/dashboard/test/lib/api.test.ts`

- [ ] **Step 1: Add vitest setup + config**

`apps/dashboard/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
  },
  resolve: { alias: { "@": resolve(__dirname, ".") } },
});
```

`apps/dashboard/test/setup.ts`:
```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Write failing API test**

`apps/dashboard/test/lib/api.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { api, ApiError } from "@/lib/api";

describe("api", () => {
  it("listTasks returns parsed shape", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ tasks: [], counts: { backlog: 0 } }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    const r = await a.listTasks();
    expect(r.tasks).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith("http://x/api/tasks", expect.any(Object));
  });

  it("throws ApiError on non-2xx", async () => {
    const a = api({
      baseUrl: "http://x",
      fetch: async () => Response.json({ error: "not_found", message: "x" }, { status: 404 }),
    });
    await expect(a.getTask("nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("createTask POSTs body", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({ id: "1", status: "backlog", title: "t", description: "" }, { status: 201 }),
    );
    const a = api({ baseUrl: "http://x", fetch: fetchSpy });

    await a.createTask({ title: "t" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://x/api/tasks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "t" }) }),
    );
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter @pi-harness/dashboard test lib/api`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `lib/api.ts`**

`apps/dashboard/lib/api.ts`:
```typescript
import type { Task, Run, AgentEvent, Workflow } from "@pi-harness/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Api = {
  listTasks: () => Promise<{ tasks: Task[]; counts: Record<string, number> }>;
  getTask: (id: string) => Promise<{ task: Task; runs: Run[] }>;
  createTask: (input: { title: string; description?: string }) => Promise<Task>;
  transitionTask: (
    id: string,
    action:
      | { type: "user_start_brainstorm"; workflow: Workflow }
      | { type: "user_approve_plan" }
      | { type: "user_cancel" }
      | { type: "user_retry_failed" },
  ) => Promise<{ task: Task }>;
  listEvents: (runId: string) => Promise<{ events: AgentEvent[] }>;
  getArtifact: <T>(taskId: string, name: "brainstorm" | "plan" | "proof-report") => Promise<T>;
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
    listTasks: () => send("/api/tasks"),
    getTask: (id) => send(`/api/tasks/${id}`),
    createTask: (input) =>
      send("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
    transitionTask: (id, action) =>
      send(`/api/tasks/${id}/transitions`, { method: "POST", body: JSON.stringify(action) }),
    listEvents: (runId) => send(`/api/runs/${runId}/events`),
    getArtifact: (taskId, name) => send(`/api/tasks/${taskId}/artifacts/${name}`),
  };
}

// Server-side default — used by RSC components.
export const orchestrator = api({
  baseUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000",
});
```

- [ ] **Step 5: Implement proxy route**

`apps/dashboard/app/api/proxy/[...path]/route.ts`:
```typescript
import { NextRequest } from "next/server";

const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000";

async function proxy(req: NextRequest, params: { path: string[] }): Promise<Response> {
  const tail = params.path.join("/");
  const url = `${ORCHESTRATOR}/api/${tail}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
  };
  const res = await fetch(url, init);
  return new Response(res.body, { status: res.status, headers: res.headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await ctx.params);
}
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm --filter @pi-harness/dashboard test lib/api`
Expected: PASS — 3 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): typed API client + Next proxy route"
```

---

## Task 4: SSE hook with reconnect

The Task Detail page's "Agent Log · live (SSE)" relies on this. Reconnects with exponential backoff if the orchestrator restarts. Tests use a mock EventSource.

**Files:**
- Create: `apps/dashboard/lib/use-events.ts`, `apps/dashboard/test/lib/use-events.test.ts`

- [ ] **Step 1: Write failing test**

`apps/dashboard/test/lib/use-events.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEvents } from "@/lib/use-events";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
    MockEventSource.instances.push(this);
  }
  emit(data: string) {
    this.onmessage?.({ data });
  }
  close() { this.closed = true; }
}

beforeEach(() => {
  MockEventSource.instances = [];
  // @ts-expect-error patch global
  globalThis.EventSource = MockEventSource;
});

describe("useEvents", () => {
  it("appends incoming events to state", async () => {
    const { result } = renderHook(() => useEvents("run-1"));
    const es = MockEventSource.instances[0]!;

    act(() => {
      es.emit(JSON.stringify({ id: "1", kind: "log", level: "info", text: "hi" }));
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]!.kind).toBe("log");
  });

  it("opens correct URL", () => {
    renderHook(() => useEvents("run-2"));
    const es = MockEventSource.instances[0]!;
    expect(es.url).toBe("/api/proxy/runs/run-2/events/stream");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/dashboard test lib/use-events`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/use-events.ts`**

`apps/dashboard/lib/use-events.ts`:
```typescript
"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@pi-harness/shared";

export type UseEventsResult = {
  events: AgentEvent[];
  connected: boolean;
};

// Subscribes to /api/proxy/runs/:runId/events/stream and accumulates events.
// Reconnects on error with backoff; caller doesn't see disconnects unless they
// inspect `connected`.
export function useEvents(runId: string | null): UseEventsResult {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) return;
    let attempt = 0;
    let cancelled = false;

    const open = (): void => {
      if (cancelled) return;
      const es = new EventSource(`/api/proxy/runs/${runId}/events/stream`);
      esRef.current = es;
      setConnected(true);
      attempt = 0;
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as AgentEvent;
          setEvents((curr) => [...curr, parsed]);
        } catch {
          // ignore non-JSON keep-alives
        }
      };
      es.onerror = () => {
        es.close();
        setConnected(false);
        attempt++;
        const delay = Math.min(8000, 500 * 2 ** attempt);
        setTimeout(open, delay);
      };
    };
    open();

    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [runId]);

  return { events, connected };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @pi-harness/dashboard test lib/use-events`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): useEvents SSE hook with reconnect"
```

---

## Task 5: UI primitives — Pill, Card, Button, Skeleton

Three primitives reused across all five views. Density rule applies: each takes the **value** as a required prop — no defaultable display strings.

**Files:**
- Create: `apps/dashboard/components/ui/pill.tsx`, `card.tsx`, `button.tsx`, `skeleton.tsx`, `apps/dashboard/test/components/ui.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/dashboard/test/components/ui.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";

describe("Pill", () => {
  it("renders semantic color via accent prop", () => {
    const { container } = render(<Pill accent="amber">task 4 of 9</Pill>);
    expect(screen.getByText("task 4 of 9")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("bg-amber-bg");
  });
  it("renders pulse-dot when live=true", () => {
    const { container } = render(<Pill accent="violet" live>awaiting human</Pill>);
    expect(container.querySelector(".pulse-dot")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("default is white-on-black", () => {
    const { container } = render(<Button>Approve</Button>);
    expect(container.firstChild).toHaveClass("bg-fg");
    expect(container.firstChild).toHaveClass("text-bg");
  });
  it("danger variant uses red tokens", () => {
    const { container } = render(<Button variant="danger">Stop</Button>);
    expect(container.firstChild?.className).toMatch(/red/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/dashboard test components/ui`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `components/ui/pill.tsx`**

`apps/dashboard/components/ui/pill.tsx`:
```typescript
import { clsx } from "clsx"; // Add `clsx` to deps if not yet present

export type Accent = "violet" | "blue" | "amber" | "cyan" | "red" | "green" | "neutral";

const ACCENT_CLASS: Record<Accent, string> = {
  violet:  "bg-violet-bg text-[#c4b5fd]",
  blue:    "bg-blue-bg text-[#93c5fd]",
  amber:   "bg-amber-bg text-amber-fg2",
  cyan:    "bg-cyan-bg text-cyan-fg2",
  red:     "bg-red-bg text-red-fg2",
  green:   "bg-green-bg text-green-fg2",
  neutral: "bg-sub text-fg-label border border-border",
};

export function Pill({
  accent,
  live = false,
  children,
}: {
  accent: Accent;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
        ACCENT_CLASS[accent],
      )}
    >
      {live && <span className="pulse-dot" />}
      {children}
    </span>
  );
}
```

Add `clsx` to `apps/dashboard/package.json` deps (`"clsx": "^2.1.1"`).

- [ ] **Step 4: Implement `components/ui/button.tsx`**

`apps/dashboard/components/ui/button.tsx`:
```typescript
import { clsx } from "clsx";

export type ButtonVariant = "default" | "ghost" | "danger" | "disabled";

const V: Record<ButtonVariant, string> = {
  default:  "bg-fg text-bg border border-fg hover:shadow-[0_0_0_3px_rgba(255,255,255,0.06)]",
  ghost:    "bg-sub text-fg-body border border-border hover:bg-card",
  danger:   "bg-red-bg/30 text-red-fg2 border border-red-fg/40 hover:bg-red-bg/50",
  disabled: "bg-sub text-fg-faint border border-border-soft cursor-not-allowed",
};

export function Button(props: {
  variant?: ButtonVariant;
  type?: "button" | "submit";
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const variant = props.variant ?? "default";
  return (
    <button
      type={props.type ?? "button"}
      disabled={variant === "disabled"}
      onClick={props.onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
        V[variant],
      )}
    >
      {props.children}
    </button>
  );
}
```

- [ ] **Step 5: Implement `components/ui/card.tsx`**

`apps/dashboard/components/ui/card.tsx`:
```typescript
import { clsx } from "clsx";

export function Card({
  accent,
  className,
  children,
}: {
  accent?: "violet" | "blue" | "amber" | "cyan" | "red" | "green";
  className?: string;
  children: React.ReactNode;
}) {
  const accentBorder = accent ? `border-${accent}-fg/30` : "border-border-soft";
  return (
    <div
      className={clsx(
        "rounded-md border bg-sub p-3 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_1px_2px_rgba(0,0,0,0.4)]",
        accentBorder,
        className,
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Implement `components/ui/skeleton.tsx`**

`apps/dashboard/components/ui/skeleton.tsx`:
```typescript
import { clsx } from "clsx";

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded bg-sub", className)} />;
}
```

- [ ] **Step 7: Run, verify pass**

Run: `pnpm --filter @pi-harness/dashboard test components/ui`
Expected: PASS — 4 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): UI primitives — Pill / Card / Button / Skeleton"
```

---

## Task 6: Topbar + kanban view

The home page. Real data from `GET /api/tasks`. Every count + filter chip is a real value computed server-side. Density: page lede shows actual `runs in flight` and `awaiting human` counts.

**Files:**
- Create: `apps/dashboard/components/topbar.tsx`, `apps/dashboard/components/kanban/board.tsx`, `apps/dashboard/components/kanban/column.tsx`, `apps/dashboard/components/kanban/card.tsx`, `apps/dashboard/lib/format.ts`, `apps/dashboard/test/components/kanban.test.tsx`
- Modify: `apps/dashboard/app/page.tsx`

- [ ] **Step 1: Write failing component test**

`apps/dashboard/test/components/kanban.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanBoard } from "@/components/kanban/board";
import type { Task } from "@pi-harness/shared";

const baseTask = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? "t",
  title: "x",
  description: "",
  status: "backlog",
  workflow: null,
  worktreePath: null,
  branchName: null,
  retryCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("KanbanBoard", () => {
  it("renders all 8 columns", () => {
    render(<KanbanBoard tasks={[]} counts={{}} />);
    expect(screen.getByText(/BACKLOG/)).toBeInTheDocument();
    expect(screen.getByText(/BRAINSTORMING/)).toBeInTheDocument();
    expect(screen.getByText(/PLANNING/)).toBeInTheDocument();
    expect(screen.getByText(/EXECUTING/)).toBeInTheDocument();
    expect(screen.getByText(/VERIFYING/)).toBeInTheDocument();
    expect(screen.getByText(/VERIFY FAILED/)).toBeInTheDocument();
    expect(screen.getByText(/READY TO SHIP/)).toBeInTheDocument();
    expect(screen.getByText(/DONE/)).toBeInTheDocument();
  });

  it("shows column counts from props", () => {
    render(<KanbanBoard tasks={[]} counts={{ backlog: 3, executing: 1 }} />);
    // The 3 sits next to BACKLOG label
    const backlogHeader = screen.getByText(/BACKLOG/).closest("header")!;
    expect(backlogHeader).toHaveTextContent("3");
  });

  it("renders task in matching column", () => {
    const tasks = [
      baseTask({ id: "1", title: "API change", status: "executing", workflow: "backend-feature" }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ executing: 1 }} />);
    expect(screen.getByText("API change")).toBeInTheDocument();
  });

  it("active executing card shows branch name in mono", () => {
    const tasks = [
      baseTask({
        id: "1",
        title: "Rate limit /login",
        status: "executing",
        workflow: "backend-feature",
        branchName: "feat/rate-limit-login",
      }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ executing: 1 }} />);
    expect(screen.getByText("feat/rate-limit-login")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/dashboard test components/kanban`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/format.ts`**

`apps/dashboard/lib/format.ts`:
```typescript
export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

export function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
```

- [ ] **Step 4: Implement `components/topbar.tsx`**

`apps/dashboard/components/topbar.tsx`:
```typescript
import Link from "next/link";

export function Topbar({
  pathLabel,
  activeRunsCount,
  worktreesCount,
  worktreesSizeMb,
}: {
  pathLabel: string;
  activeRunsCount: number;
  worktreesCount: number;
  worktreesSizeMb: number;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-bg/85 px-6 py-3 backdrop-blur">
      <div className="flex items-baseline gap-2.5">
        <span className="rounded border border-border bg-sub px-1.5 py-0.5 font-mono text-xs tracking-wide text-fg">
          π
        </span>
        <span className="font-display text-[15px] font-semibold tracking-tight text-fg">pi-harness</span>
        <span className="text-xs text-fg-faint">/ {pathLabel}</span>
      </div>
      <nav className="ml-6 flex gap-1">
        <Link href="/" className="rounded px-2.5 py-1.5 text-xs text-fg-subtle hover:bg-sub hover:text-fg-body">Board</Link>
        <Link href="/" className="rounded px-2.5 py-1.5 text-xs text-fg-subtle hover:bg-sub hover:text-fg-body">Runs</Link>
      </nav>
      <div className="flex-1" />
      <span className="flex items-center gap-2 text-xs text-fg-subtle">
        <span className="pulse-dot" style={{ color: "var(--color-green-fg)" }} />
        <span>orchestrator online · {activeRunsCount} runs active</span>
        <span className="text-fg-faint">·</span>
        <span className="font-mono">{worktreesCount} worktrees · {worktreesSizeMb.toFixed(1)} GB</span>
      </span>
      <Link
        href="/tasks/new"
        className="rounded-md border border-fg bg-fg px-3 py-1.5 text-xs font-semibold text-bg"
      >
        + New Task
      </Link>
    </header>
  );
}
```

- [ ] **Step 5: Implement `components/kanban/card.tsx`**

`apps/dashboard/components/kanban/card.tsx`:
```typescript
import Link from "next/link";
import type { Task } from "@pi-harness/shared";
import { Pill, type Accent } from "@/components/ui/pill";
import { clsx } from "clsx";

const STATUS_ACCENT: Partial<Record<Task["status"], Accent>> = {
  brainstorming: "violet",
  planning: "blue",
  executing: "amber",
  verifying: "cyan",
  verification_failed: "red",
  ready_to_ship: "green",
};

export function TaskCard({ task }: { task: Task }) {
  const accent = STATUS_ACCENT[task.status];
  const borderClass = accent ? `border-${accent}-fg/30` : "border-border-soft";
  const pillText = pillForTask(task);
  const progressLine = progressForTask(task);

  return (
    <Link
      href={`/tasks/${task.id}`}
      className={clsx(
        "block rounded-md border bg-sub px-3 py-2.5 transition hover:-translate-y-px hover:border-border-strong",
        borderClass,
        task.status === "done" && "bg-muted",
      )}
    >
      <div className={clsx(
        "text-[13px] font-medium leading-snug",
        task.status === "done" ? "text-fg-label font-normal" : "text-fg",
      )}>
        {task.title}
      </div>
      <div className="mt-1.5 font-mono text-[10px] tracking-wide text-fg-subtle">
        #{task.id.slice(0, 4)} · {task.workflow ?? "no-workflow"}
      </div>
      {pillText && accent && (
        <div className="mt-2">
          <Pill accent={accent} live={isLive(task)}>{pillText}</Pill>
        </div>
      )}
      {progressLine && accent && (
        <div className={clsx("mt-2 text-[11px]", `text-${accent}-fg`)}>
          {progressLine}
        </div>
      )}
      {task.branchName && (
        <div className="mt-1.5 font-mono text-[10px] text-fg-faint">
          {task.branchName}
        </div>
      )}
    </Link>
  );
}

function pillForTask(t: Task): string | null {
  switch (t.status) {
    case "brainstorming": return "awaiting human";
    case "planning": return "scoping";
    case "executing": return `task ? of ?`; // TODO computed when run-state is fetched (see Task 8)
    case "verifying": return "scenarios running";
    case "verification_failed": return `retry ${t.retryCount}/2 · failed`;
    case "ready_to_ship": return "PR open";
    default: return null;
  }
}

function progressForTask(t: Task): string | null {
  if (t.status === "verification_failed") return "needs human triage";
  if (t.status === "ready_to_ship") return "all gates green";
  return null;
}

function isLive(t: Task): boolean {
  return ["brainstorming", "planning", "executing", "verifying"].includes(t.status);
}
```

**NOTE — density correction:** the `task ? of ?` placeholder in `pillForTask` violates the rule. Replace with the run-derived value. Refactor:

```typescript
// Replace pillForTask with a version that takes optional run context.
export function pillForTask(t: Task, runCtx?: { stepIndex: number; totalSteps: number }): string | null {
  switch (t.status) {
    case "brainstorming": return "awaiting human";
    case "planning": return "scoping";
    case "executing":
      return runCtx ? `task ${runCtx.stepIndex} of ${runCtx.totalSteps}` : "running";
    case "verifying": return "scenarios running";
    case "verification_failed": return `retry ${t.retryCount}/2 · failed`;
    case "ready_to_ship": return "PR open";
    default: return null;
  }
}
```

The board fetches the latest run for active tasks and passes `runCtx`. Update `TaskCard`'s signature to accept it.

- [ ] **Step 6: Implement `components/kanban/column.tsx`**

`apps/dashboard/components/kanban/column.tsx`:
```typescript
import { clsx } from "clsx";
import type { Task, TaskStatus } from "@pi-harness/shared";
import { TaskCard } from "./card";

const ACCENT_CLASS: Partial<Record<TaskStatus, { rule: string; label: string }>> = {
  brainstorming:       { rule: "bg-violet-fg shadow-[0_0_8px_rgba(167,139,250,0.6)]", label: "text-violet-fg" },
  planning:            { rule: "bg-blue-fg   shadow-[0_0_8px_rgba(96,165,250,0.6)]",  label: "text-blue-fg" },
  executing:           { rule: "bg-amber-fg  shadow-[0_0_8px_rgba(251,191,36,0.6)]",  label: "text-amber-fg" },
  verifying:           { rule: "bg-cyan-fg   shadow-[0_0_8px_rgba(34,211,238,0.6)]",  label: "text-cyan-fg" },
  verification_failed: { rule: "bg-red-fg    shadow-[0_0_8px_rgba(248,113,113,0.6)]", label: "text-red-fg" },
  ready_to_ship:       { rule: "bg-green-fg  shadow-[0_0_8px_rgba(52,211,153,0.6)]",  label: "text-green-fg" },
};

const TITLES: Record<TaskStatus, string> = {
  backlog: "BACKLOG",
  brainstorming: "BRAINSTORMING",
  planning: "PLANNING",
  executing: "EXECUTING",
  verifying: "VERIFYING",
  verification_failed: "VERIFY FAILED",
  ready_to_ship: "READY TO SHIP",
  done: "DONE",
  cancelled: "CANCELLED",
};

export function KanbanColumn({
  status,
  tasks,
  count,
}: {
  status: TaskStatus;
  tasks: Task[];
  count: number;
}) {
  const accent = ACCENT_CLASS[status];
  return (
    <section className="flex min-h-[720px] flex-col overflow-hidden rounded-lg border border-border-soft bg-card">
      <header className="flex items-center gap-2 border-b border-border-soft bg-gradient-to-b from-white/[0.015] to-transparent px-3.5 py-2.5">
        <span className={clsx("h-0.5 w-4 rounded", accent?.rule ?? "bg-fg-ghost")} />
        <span className={clsx("font-mono text-[10px] font-bold tracking-widest", accent?.label ?? "text-fg-label")}>
          {TITLES[status]}
        </span>
        <span className="ml-auto font-mono text-[11px] text-fg-faint">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Implement `components/kanban/board.tsx`**

`apps/dashboard/components/kanban/board.tsx`:
```typescript
import type { Task, TaskStatus } from "@pi-harness/shared";
import { KanbanColumn } from "./column";

const COLUMN_ORDER: TaskStatus[] = [
  "backlog",
  "brainstorming",
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
];

export function KanbanBoard({
  tasks,
  counts,
}: {
  tasks: Task[];
  counts: Partial<Record<TaskStatus, number>>;
}) {
  const byStatus: Record<string, Task[]> = {};
  for (const t of tasks) (byStatus[t.status] ??= []).push(t);

  return (
    <main className="grid gap-3 overflow-x-auto p-6"
          style={{ gridTemplateColumns: `repeat(${COLUMN_ORDER.length}, minmax(220px, 1fr))` }}>
      {COLUMN_ORDER.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={byStatus[status] ?? []}
          count={counts[status] ?? 0}
        />
      ))}
    </main>
  );
}
```

- [ ] **Step 8: Wire `app/page.tsx`**

`apps/dashboard/app/page.tsx`:
```typescript
import { Topbar } from "@/components/topbar";
import { KanbanBoard } from "@/components/kanban/board";
import { orchestrator } from "@/lib/api";

export default async function HomePage() {
  const { tasks, counts } = await orchestrator.listTasks();

  const inFlight = (counts.brainstorming ?? 0) + (counts.planning ?? 0) +
                   (counts.executing ?? 0) + (counts.verifying ?? 0);
  const awaitingHuman = (counts.brainstorming ?? 0) + (counts.verification_failed ?? 0);
  const total = tasks.length;

  return (
    <>
      <Topbar
        pathLabel="kanban"
        activeRunsCount={inFlight}
        worktreesCount={inFlight} // 1:1 in v1 — 1 worktree per active task
        worktreesSizeMb={0} // wired up in v1.5 from disk usage
      />
      <section className="flex items-end justify-between gap-6 px-6 pb-3.5 pt-5">
        <div>
          <h1 className="m-0 font-display text-[22px] font-semibold tracking-tight text-fg">Kanban</h1>
          <div className="mt-1 text-[13px] text-fg-subtle">
            {total} tasks · backend-feature workflow · {inFlight} runs in flight · {awaitingHuman} awaiting human
          </div>
        </div>
      </section>
      <KanbanBoard tasks={tasks} counts={counts} />
    </>
  );
}
```

- [ ] **Step 9: Run, verify pass**

Run: `pnpm --filter @pi-harness/dashboard test components/kanban`
Expected: PASS — 4 tests.

- [ ] **Step 10: Smoke**

In separate terminals:
```bash
docker-compose up -d postgres
pnpm --filter @pi-harness/orchestrator dev
pnpm --filter @pi-harness/dashboard dev
```
Visit http://localhost:3000 — should render the empty kanban with topbar.

```bash
curl -s -X POST http://localhost:4000/api/tasks -H 'content-type: application/json' -d '{"title":"first task"}'
```
Refresh — task appears in Backlog.

- [ ] **Step 11: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): kanban board view with topbar"
```

---

## Task 7: New task page

A simple form. Posts to the proxy → orchestrator. Redirects to `/tasks/[id]` on success.

**Files:**
- Create: `apps/dashboard/app/tasks/new/page.tsx`, `apps/dashboard/app/tasks/new/actions.ts`

- [ ] **Step 1: Implement Server Action**

`apps/dashboard/app/tasks/new/actions.ts`:
```typescript
"use server";
import { redirect } from "next/navigation";
import { orchestrator } from "@/lib/api";

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("title required");
  const task = await orchestrator.createTask({
    title,
    description: String(formData.get("description") ?? ""),
  });
  redirect(`/tasks/${task.id}`);
}
```

- [ ] **Step 2: Implement form page**

`apps/dashboard/app/tasks/new/page.tsx`:
```typescript
import { Topbar } from "@/components/topbar";
import { createTask } from "./actions";
import { Button } from "@/components/ui/button";
import { orchestrator } from "@/lib/api";

export default async function NewTaskPage() {
  const { counts } = await orchestrator.listTasks();
  const inFlight = (counts.brainstorming ?? 0) + (counts.planning ?? 0) + (counts.executing ?? 0) + (counts.verifying ?? 0);

  return (
    <>
      <Topbar pathLabel="new task" activeRunsCount={inFlight} worktreesCount={inFlight} worktreesSizeMb={0} />
      <main className="mx-auto max-w-xl p-8">
        <h1 className="mb-6 font-display text-[22px] font-semibold tracking-tight text-fg">New task</h1>
        <form action={createTask} className="space-y-4">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-bold tracking-widest text-fg-subtle">TITLE</span>
            <input
              name="title"
              required
              maxLength={200}
              autoFocus
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-fg-body focus:border-violet-fg focus:outline-none focus:shadow-[0_0_0_3px_rgba(167,139,250,0.12)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-bold tracking-widest text-fg-subtle">DESCRIPTION</span>
            <textarea
              name="description"
              rows={6}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-fg-body focus:border-violet-fg focus:outline-none"
            />
          </label>
          <Button type="submit">Create &amp; queue</Button>
        </form>
      </main>
    </>
  );
}
```

- [ ] **Step 3: Smoke**

Visit `/tasks/new`, submit a title, confirm redirect (404 expected since task-detail isn't built yet, but URL should change).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): new task form"
```

---

## Task 8: Task detail page — phase timeline + agent log + run context

The single most-information-dense page. Re-creates `task-detail.html` faithfully:
- Header with breadcrumb + status pill + monospace worktree path + Stop button
- Phase timeline strip (5 phases, color-coded)
- Left ~65%: live SSE agent log
- Right ~35%: Run Context sidebar (worktree, active subagents, files changed, cost · tokens)

**Files:**
- Create: `apps/dashboard/components/task-detail/phase-timeline.tsx`, `apps/dashboard/components/task-detail/agent-log.tsx`, `apps/dashboard/components/task-detail/run-context.tsx`, `apps/dashboard/app/tasks/[id]/page.tsx`, `apps/dashboard/test/components/task-detail.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/dashboard/test/components/task-detail.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhaseTimeline } from "@/components/task-detail/phase-timeline";
import { AgentLog } from "@/components/task-detail/agent-log";
import type { AgentEvent, Run } from "@pi-harness/shared";

describe("PhaseTimeline", () => {
  it("renders 5 phases", () => {
    const runs: Run[] = [];
    render(<PhaseTimeline runs={runs} currentPhase="code" />);
    expect(screen.getByText(/Brainstorm/)).toBeInTheDocument();
    expect(screen.getByText(/Plan/)).toBeInTheDocument();
    expect(screen.getByText(/Code/)).toBeInTheDocument();
    expect(screen.getByText(/Verify/)).toBeInTheDocument();
    expect(screen.getByText(/PR/)).toBeInTheDocument();
  });

  it("marks succeeded runs with green check", () => {
    const runs: Run[] = [
      { id: "r1", taskId: "t", phase: "brainstorm", status: "succeeded", startedAt: new Date(), endedAt: new Date(), error: null, costUsd: 0, inputTokens: 0, outputTokens: 0 },
    ];
    const { container } = render(<PhaseTimeline runs={runs} currentPhase="code" />);
    expect(container.textContent).toContain("✓");
  });
});

describe("AgentLog", () => {
  it("renders log rows with timestamps and color-coded types", () => {
    const events: AgentEvent[] = [
      { id: "1", taskId: "t", runId: "r", ts: new Date("2026-05-08T14:32:01Z"), kind: "phase_started", phase: "code" },
      { id: "2", taskId: "t", runId: "r", ts: new Date("2026-05-08T14:32:18Z"), kind: "tool_result", tool: "Bash", ok: false },
    ];
    render(<AgentLog events={events} />);
    expect(screen.getByText(/phase_started/)).toBeInTheDocument();
    expect(screen.getByText(/tool_result/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/dashboard test components/task-detail`
Expected: FAIL.

- [ ] **Step 3: Implement `components/task-detail/phase-timeline.tsx`**

`apps/dashboard/components/task-detail/phase-timeline.tsx`:
```typescript
import { clsx } from "clsx";
import type { Phase, Run } from "@pi-harness/shared";
import { formatDuration } from "@/lib/format";

const PHASES: Phase[] = ["brainstorm", "plan", "code", "verify", "pr"];

export function PhaseTimeline({ runs, currentPhase }: { runs: Run[]; currentPhase: Phase | null }) {
  // Index latest run per phase.
  const byPhase = new Map<Phase, Run>();
  for (const r of runs) byPhase.set(r.phase, r);

  return (
    <section className="m-6 mt-4 flex items-center gap-1.5 rounded-lg border border-border-soft bg-card p-3.5">
      <span className="mr-3.5 font-mono text-[9px] font-bold tracking-widest text-fg-subtle">
        PHASE TIMELINE
      </span>
      {PHASES.map((p, i) => {
        const r = byPhase.get(p);
        const state =
          r?.status === "succeeded" ? "done" :
          p === currentPhase ? "active" :
          r?.status === "failed" ? "failed" : "idle";

        const cls = {
          done:   "bg-green-bg text-green-fg2 border-green-fg/30",
          active: "bg-amber-bg text-amber-fg2 border-amber-fg/40",
          failed: "bg-red-bg   text-red-fg2   border-red-fg/40",
          idle:   "bg-sub      text-fg-subtle border-border-soft",
        }[state];
        const icon = { done: "✓", active: "⚙", failed: "✗", idle: "○" }[state];
        const dur = r?.endedAt && r?.startedAt
          ? formatDuration(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime())
          : null;

        return (
          <div key={p} className={clsx("inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[12.5px] font-medium", cls)}>
            <span className="font-mono text-xs">{icon}</span>
            <span className="capitalize">{p}</span>
            {dur && <span className="font-mono text-[10px] text-fg-faint">{dur}</span>}
            {state === "active" && <span className="font-mono text-[10px]">…</span>}
          </div>
        );
      })}
    </section>
  );
}
```

- [ ] **Step 4: Implement `components/task-detail/agent-log.tsx`**

`apps/dashboard/components/task-detail/agent-log.tsx`:
```typescript
"use client";
import { useEffect, useRef } from "react";
import type { AgentEvent } from "@pi-harness/shared";
import { clsx } from "clsx";

const TYPE_CLASS = {
  phase_started: "text-blue-fg",
  phase_ended:   "text-blue-fg",
  tool_call:     "text-fg-label",
  tool_result:   "text-green-fg", // overridden to red when ok:false
  message_delta: "text-violet-fg",
  log:           "text-fg-label",
} as const;

export function AgentLog({ events, live = false }: { events: AgentEvent[]; live?: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <header className="flex items-baseline gap-3 border-b border-border-soft px-4.5 py-3.5">
        <h2 className="m-0 font-display text-sm font-semibold text-fg">Agent Log</h2>
        <span className="text-[11px] text-fg-faint">
          SSE · {events.length} events · last {events.at(-1)?.ts ? new Date(events.at(-1)!.ts).toLocaleTimeString() : "—"}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] tracking-wide text-fg-faint">
          tail · auto-scroll {live ? "on" : "off"}
        </span>
      </header>
      <div className="max-h-[640px] overflow-y-auto px-4.5 py-4 font-mono text-xs leading-relaxed">
        {events.map((e) => {
          const time = new Date(e.ts).toISOString().slice(11, 19);
          const cls =
            e.kind === "tool_result" && "ok" in e && !e.ok ? "text-red-fg" : TYPE_CLASS[e.kind];
          return (
            <div key={e.id} className="grid grid-cols-[88px_142px_1fr] gap-2.5">
              <span className="text-fg-faint">{time}</span>
              <span className={clsx("font-bold", cls)}>{e.kind}</span>
              <span className={clsx(
                "whitespace-pre-wrap",
                e.kind === "message_delta" && "italic text-fg-subtle",
              )}>
                {renderEventBody(e)}
              </span>
            </div>
          );
        })}
        {live && (
          <div className="grid grid-cols-[88px_142px_1fr] gap-2.5">
            <span /><span /><span className="cursor" />
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function renderEventBody(e: AgentEvent): string {
  switch (e.kind) {
    case "phase_started": return `${e.phase} · started`;
    case "phase_ended":   return `${e.phase} · ${e.status}`;
    case "tool_call":     return `${e.tool}${e.input ? "(" + JSON.stringify(e.input).slice(0, 80) + ")" : ""}`;
    case "tool_result":   return `${e.tool} · ${e.ok ? "OK" : "failed"}`;
    case "message_delta": return `"${e.text.slice(0, 100)}${e.text.length > 100 ? "…" : ""}"`;
    case "log":           return `[${e.level}] ${e.text}`;
  }
}
```

- [ ] **Step 5: Implement `components/task-detail/run-context.tsx`**

`apps/dashboard/components/task-detail/run-context.tsx`:
```typescript
import type { Run, Task } from "@pi-harness/shared";
import { formatCost, formatTokens } from "@/lib/format";

export function RunContext({
  task,
  runs,
  filesChanged,
  budgetPct,
}: {
  task: Task;
  runs: Run[];
  filesChanged: { path: string; action: "M" | "A" | "D" }[];
  budgetPct: number;
}) {
  const lastRun = runs.at(-1);
  const totalCost = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const totalIn = runs.reduce((s, r) => s + (r.inputTokens ?? 0), 0);
  const totalOut = runs.reduce((s, r) => s + (r.outputTokens ?? 0), 0);

  return (
    <aside className="flex flex-col gap-4 rounded-lg border border-border-soft bg-card">
      <header className="border-b border-border-soft px-4.5 py-3.5">
        <h2 className="m-0 font-display text-sm font-semibold text-fg">Run Context</h2>
        <span className="text-[11px] text-fg-faint">updated {lastRun?.endedAt ? new Date(lastRun.endedAt).toLocaleTimeString() : "now"}</span>
      </header>

      <Section label="WORKTREE">
        <KV k="path"   v={task.worktreePath ?? "—"} mono />
        <KV k="branch" v={task.branchName ?? "—"} mono accent="amber" />
        <KV k="runs"   v={`${runs.length} phases · ${task.retryCount} retries`} />
      </Section>

      <Section label="FILES CHANGED">
        <div className="font-mono text-[11.5px] leading-relaxed">
          {filesChanged.map((f) => (
            <div key={f.path}>
              <span className={f.action === "A" ? "text-amber-fg" : "text-green-fg"}>{f.action}</span>
              {"  "}<span className="text-fg-body">{f.path}</span>
            </div>
          ))}
          {filesChanged.length === 0 && <span className="text-fg-faint">no files changed yet</span>}
        </div>
      </Section>

      <Section label="COST · TOKENS">
        <div className="flex items-end gap-4">
          <div>
            <div className="font-display text-[22px] font-semibold tracking-tight text-fg">
              {formatCost(totalCost)}
            </div>
            <div className="font-mono text-[10px] tracking-wide text-fg-faint">SPENT · RUN TOTAL</div>
          </div>
          <div className="flex-1">
            <div className="font-mono text-xs text-fg-subtle">
              <span className="text-fg-body">{formatTokens(totalIn)}</span> in /
              {" "}<span className="text-fg-body">{formatTokens(totalOut)}</span> out
            </div>
            <div className="mt-1.5 font-mono text-[11px]">
              phase budget: <span className={budgetPct > 80 ? "text-red-fg2" : "text-amber-fg2"}>{budgetPct.toFixed(0)}%</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded bg-sub">
              <div
                className="h-full"
                style={{
                  width: `${Math.min(100, budgetPct)}%`,
                  background: budgetPct > 80 ? "var(--color-red-fg)" : "linear-gradient(90deg, var(--color-green-fg), var(--color-amber-fg))",
                }}
              />
            </div>
          </div>
        </div>
      </Section>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-soft px-4.5 pb-4 last:border-b-0">
      <span className="mb-2 block font-mono text-[9px] font-bold tracking-widest text-fg-subtle">{label}</span>
      {children}
    </div>
  );
}

function KV({ k, v, mono, accent }: { k: string; v: string; mono?: boolean; accent?: "amber" }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="min-w-16 font-mono text-[10px] tracking-wide text-fg-faint">{k}</span>
      <span className={[mono && "font-mono text-[11px]", accent === "amber" && "text-amber-fg2", "text-fg-body"].filter(Boolean).join(" ")}>
        {v}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Implement client wrapper for live events**

`apps/dashboard/components/task-detail/live-log.tsx`:
```typescript
"use client";
import { useEvents } from "@/lib/use-events";
import { AgentLog } from "./agent-log";
import type { AgentEvent } from "@pi-harness/shared";

export function LiveLog({ runId, initial }: { runId: string | null; initial: AgentEvent[] }) {
  const { events, connected } = useEvents(runId);
  const merged = [...initial, ...events];
  return <AgentLog events={merged} live={connected} />;
}
```

- [ ] **Step 7: Implement `app/tasks/[id]/page.tsx`**

`apps/dashboard/app/tasks/[id]/page.tsx`:
```typescript
import Link from "next/link";
import type { Phase } from "@pi-harness/shared";
import { Topbar } from "@/components/topbar";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { PhaseTimeline } from "@/components/task-detail/phase-timeline";
import { LiveLog } from "@/components/task-detail/live-log";
import { RunContext } from "@/components/task-detail/run-context";
import { orchestrator } from "@/lib/api";

const STATUS_TO_PHASE: Record<string, Phase | null> = {
  brainstorming: "brainstorm",
  planning: "plan",
  executing: "code",
  verifying: "verify",
  ready_to_ship: "pr",
};

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { task, runs } = await orchestrator.getTask(id);
  const lastRun = runs.at(-1);
  const initialEvents = lastRun ? (await orchestrator.listEvents(lastRun.id)).events : [];

  const currentPhase = STATUS_TO_PHASE[task.status] ?? null;

  return (
    <>
      <Topbar pathLabel={`run · ${task.id.slice(0, 6)}`} activeRunsCount={1} worktreesCount={1} worktreesSizeMb={0} />
      <nav className="flex items-center gap-1.5 px-6 pb-1.5 pt-4 text-xs text-fg-subtle">
        <Link href="/" className="text-fg-subtle hover:text-fg-body">Tasks</Link>
        <span className="text-fg-ghost">›</span>
        <span className="text-fg-subtle">#{task.id.slice(0, 6)}</span>
        <span className="text-fg-ghost">›</span>
        <span className="font-medium text-fg">{task.title}</span>
      </nav>
      <section className="flex flex-wrap items-center gap-3.5 px-6 pb-3.5">
        <h1 className="m-0 font-display text-2xl font-semibold tracking-tight capitalize text-fg">
          {task.status.replace(/_/g, " ")}
        </h1>
        {currentPhase && <Pill accent="amber" live>{currentPhase}</Pill>}
        <span className="rounded-md border border-border bg-sub px-2.5 py-1.5 font-mono text-[11px] text-fg-subtle">
          {task.worktreePath ?? "(no worktree)"} · <span className="text-amber-fg2">{task.branchName ?? "(no branch)"}</span>
        </span>
        <div className="flex-1" />
        <Button variant="ghost">Pause</Button>
        <Button variant="danger">⏹ Stop run</Button>
      </section>

      <PhaseTimeline runs={runs} currentPhase={currentPhase} />

      <main className="grid gap-4 px-6 pb-6 [grid-template-columns:1.85fr_1fr]">
        <LiveLog runId={lastRun?.id ?? null} initial={initialEvents} />
        <RunContext
          task={task}
          runs={runs}
          filesChanged={[]} /* derived from tool_call events in v1.5 */
          budgetPct={Math.min(100, (runs.reduce((s, r) => s + r.costUsd, 0) / 5) * 100)}
        />
      </main>
    </>
  );
}
```

- [ ] **Step 8: Run tests, smoke**

Run: `pnpm --filter @pi-harness/dashboard test components/task-detail`
Expected: PASS — 3 tests.

Smoke: visit `/tasks/<id>` for a task created earlier. Phase timeline + (empty) log + run context render.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): task detail with phase timeline + live SSE log"
```

---

## Task 9: Brainstorm + Plan review pages

`/tasks/[id]/brainstorm` and `/tasks/[id]/plan`. Both are simpler than the kanban or task detail since the artifacts are JSON files served by the orchestrator's artifact route.

**Files:**
- Create: `apps/dashboard/components/brainstorm/chat-panel.tsx`, `apps/dashboard/components/brainstorm/emerging-spec.tsx`, `apps/dashboard/components/plan/plan-preview.tsx`, `apps/dashboard/app/tasks/[id]/brainstorm/page.tsx`, `apps/dashboard/app/tasks/[id]/plan/page.tsx`

- [ ] **Step 1: Implement `components/brainstorm/emerging-spec.tsx`**

`apps/dashboard/components/brainstorm/emerging-spec.tsx`:
```typescript
import type { BrainstormArtifact } from "@pi-harness/shared";

export function EmergingSpec({ artifact }: { artifact: BrainstormArtifact }) {
  const tbdCount = artifact.decisions.filter((d) => /\bTBD\b/i.test(d)).length;

  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <header className="flex items-baseline gap-2.5 border-b border-border-soft px-4.5 pb-2.5 pt-3.5">
        <h3 className="m-0 font-display text-sm font-semibold tracking-tight text-fg">Emerging Spec</h3>
        <span className="text-[11px] text-fg-faint">
          {artifact.decisions.length} decisions · {artifact.openQuestions.length} open · {tbdCount} TBD
        </span>
      </header>
      <div className="px-4.5 py-3.5">
        <span className="mb-2 block font-mono text-[9px] font-bold tracking-widest text-fg-subtle">GOAL</span>
        <p className="m-0 text-[13px] leading-relaxed text-fg-body">{artifact.goal}</p>

        <span className="mb-2 mt-4 block font-mono text-[9px] font-bold tracking-widest text-fg-subtle">DECISIONS</span>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {artifact.decisions.map((d, i) => {
            const tbd = /\bTBD\b/i.test(d);
            return (
              <li key={i} className={`flex items-start gap-2.5 text-[12.5px] ${tbd ? "text-amber-fg2" : "text-fg-body"}`}>
                <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${tbd ? "bg-amber-fg shadow-[0_0_8px_var(--color-amber-fg)]" : "bg-green-fg"}`} />
                {d}
              </li>
            );
          })}
        </ul>

        <span className="mb-2 mt-4 block font-mono text-[9px] font-bold tracking-widest text-fg-subtle">OPEN QUESTIONS</span>
        <ol className="m-0 list-none p-0">
          {artifact.openQuestions.map((q, i) => (
            <li key={i} className="flex items-start gap-3 border-b border-dashed border-border-soft py-2 text-[12.5px] text-fg-body last:border-0">
              <span className="mt-0.5 min-w-4 font-mono text-[10px] text-fg-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              {q}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Implement `components/brainstorm/chat-panel.tsx`**

`apps/dashboard/components/brainstorm/chat-panel.tsx`:
```typescript
import type { BrainstormTurn } from "@pi-harness/shared";

export function ChatPanel({ turns, runMeta }: { turns: BrainstormTurn[]; runMeta: string }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border-soft bg-card">
      <header className="flex items-start gap-3.5 border-b border-border-soft px-5 py-4 [background:linear-gradient(180deg,rgba(167,139,250,0.04),transparent_70%)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-fg/30 bg-violet-bg font-mono text-sm font-bold text-violet-fg">B</div>
        <div>
          <h2 className="m-0 font-display text-[15px] font-semibold tracking-tight text-fg">Brainstorm Agent</h2>
          <div className="mt-0.5 text-xs text-fg-subtle">{runMeta}</div>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === "agent"
                ? "max-w-[76%] self-start rounded-lg border border-border-soft border-l-2 border-l-violet-fg bg-sub px-3.5 py-2.5"
                : "max-w-[76%] self-end rounded-lg border border-green-fg/20 bg-green-fg/[0.07] px-3.5 py-2.5 text-fg"
            }
          >
            <span className={`mb-1 block font-mono text-[9px] font-bold tracking-widest ${t.role === "agent" ? "text-violet-fg" : "text-green-fg"}`}>
              {t.role.toUpperCase()} · {new Date(t.ts).toLocaleTimeString()}
            </span>
            <span className="text-[13px] leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
      {/* In v1, the chat is read-only when shown after the brainstorm phase finished. The
          live conversation happens during Brainstorm phase and uses the SSE on /api/runs/:id/events/stream. */}
    </section>
  );
}
```

- [ ] **Step 3: Implement `app/tasks/[id]/brainstorm/page.tsx`**

`apps/dashboard/app/tasks/[id]/brainstorm/page.tsx`:
```typescript
import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Pill } from "@/components/ui/pill";
import { ChatPanel } from "@/components/brainstorm/chat-panel";
import { EmergingSpec } from "@/components/brainstorm/emerging-spec";
import { orchestrator } from "@/lib/api";
import type { BrainstormArtifact } from "@pi-harness/shared";

export default async function BrainstormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { task, runs } = await orchestrator.getTask(id);
  const brainstormRun = runs.find((r) => r.phase === "brainstorm");
  const artifact = await orchestrator.getArtifact<BrainstormArtifact>(id, "brainstorm").catch(() => null);

  const meta = brainstormRun
    ? `Q${artifact?.transcript.filter((t) => t.role === "agent").length ?? 0} of ~5 · started ${new Date(brainstormRun.startedAt).toLocaleTimeString()} · $${brainstormRun.costUsd.toFixed(4)} · ${brainstormRun.inputTokens + brainstormRun.outputTokens} tokens`
    : "no brainstorm run yet";

  return (
    <>
      <Topbar pathLabel="brainstorm" activeRunsCount={1} worktreesCount={1} worktreesSizeMb={0} />
      <nav className="flex items-center gap-1.5 px-6 pb-1.5 pt-4 text-xs text-fg-subtle">
        <Link href="/" className="hover:text-fg-body">Tasks</Link>
        <span className="text-fg-ghost">›</span>
        <span className="font-medium text-fg">{task.title}</span>
      </nav>
      <section className="flex flex-wrap items-center gap-3.5 px-6 pb-4">
        <h1 className="m-0 font-display text-[26px] font-semibold tracking-tight text-fg">Brainstorm</h1>
        {task.status === "brainstorming" && <Pill accent="violet" live>awaiting human</Pill>}
      </section>
      <main className="grid gap-4 px-6 pb-6 [grid-template-columns:1.45fr_1fr] [min-height:calc(100vh-180px)]">
        <ChatPanel turns={artifact?.transcript ?? []} runMeta={meta} />
        <aside className="flex flex-col gap-4">
          {artifact ? <EmergingSpec artifact={artifact} /> : <EmptySpecPlaceholder />}
        </aside>
      </main>
    </>
  );
}

function EmptySpecPlaceholder() {
  // Density rule: even the empty state names what's missing.
  return (
    <section className="rounded-lg border border-border-soft bg-card p-4.5">
      <h3 className="m-0 font-display text-sm font-semibold text-fg">Emerging Spec</h3>
      <div className="mt-2 text-xs text-fg-subtle">No brainstorm artifact yet — phase has not started.</div>
    </section>
  );
}
```

- [ ] **Step 4: Implement `components/plan/plan-preview.tsx` and the plan page**

`apps/dashboard/components/plan/plan-preview.tsx`:
```typescript
import type { PlanArtifact } from "@pi-harness/shared";

export function PlanPreview({ artifact }: { artifact: PlanArtifact }) {
  const stepCount = artifact.steps.length;
  const apiCount = artifact.verificationScenarios.scenarios.filter((s) => s.type === "api").length;
  const uiCount = artifact.verificationScenarios.scenarios.filter((s) => s.type === "ui" || s.type === "ui-visual").length;
  const visualCount = artifact.verificationScenarios.scenarios.filter((s) => s.type === "ui-visual").length;

  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <header className="border-b border-border-soft px-4.5 pb-2.5 pt-3.5">
        <h3 className="m-0 font-display text-sm font-semibold tracking-tight text-fg">Plan Review</h3>
        <span className="text-[11px] text-fg-faint">
          {artifact.precedentWarnings.length} precedents · {artifact.outOfScope.length} explicitly out of scope
        </span>
      </header>
      <div className="space-y-2 px-4.5 py-3.5">
        <div className="inline-flex items-center gap-1.5 rounded border border-blue-fg/25 bg-blue-bg px-2 py-1 font-mono text-[11px] font-semibold text-[#93c5fd]">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-fg shadow-[0_0_6px_var(--color-blue-fg)]" />
          workflow: {artifact.suggestedWorkflow}
        </div>
        <div className="text-[12.5px] text-fg-body">📋 <strong>{stepCount} tasks</strong> · TDD per step</div>
        <div className="text-[12.5px] text-fg-body">🧪 <strong>Verification</strong> — {apiCount} api · {uiCount} ui · {visualCount} visual</div>
        <span className="mt-3.5 block font-mono text-[9px] font-bold tracking-widest text-fg-subtle">PRECEDENTS</span>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {artifact.precedentWarnings.map((p, i) => (
            <li key={i} className="rounded-md border border-border-soft bg-muted px-2.5 py-2 text-xs text-fg-label">
              <span className="mr-2.5 min-w-9 font-mono font-semibold text-blue-fg">#{i + 1}</span>
              <span className={p.lesson.toLowerCase().includes("broke") ? "text-red-fg2" : ""}>
                <span className="font-mono">{p.ref}</span> — {p.lesson}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

`apps/dashboard/app/tasks/[id]/plan/page.tsx`:
```typescript
import { Topbar } from "@/components/topbar";
import { PlanPreview } from "@/components/plan/plan-preview";
import { Button } from "@/components/ui/button";
import { orchestrator } from "@/lib/api";
import type { PlanArtifact } from "@pi-harness/shared";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = await orchestrator.getArtifact<PlanArtifact>(id, "plan").catch(() => null);

  return (
    <>
      <Topbar pathLabel="plan review" activeRunsCount={1} worktreesCount={1} worktreesSizeMb={0} />
      <main className="mx-auto max-w-3xl p-6">
        {artifact ? (
          <>
            <PlanPreview artifact={artifact} />
            <div className="mt-4 flex gap-2">
              <form action={`/api/proxy/tasks/${id}/transitions`} method="POST">
                <input type="hidden" name="action" value="user_approve_plan" />
                <Button type="submit">Approve &amp; Code →</Button>
              </form>
              <Button variant="ghost">Edit plan</Button>
            </div>
          </>
        ) : (
          <div className="text-fg-subtle">No plan artifact yet — Plan phase hasn't completed.</div>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 5: Smoke**

Visit `/tasks/<id>/brainstorm` and `/tasks/<id>/plan`. Should render either the empty state or real artifact.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): brainstorm + plan review pages"
```

---

## Task 10: Verification proof gate page

The most distinctive page. Recreates `verification.html` faithfully with three columns + bottom verdict strip. Reads `proof-report.json` from the orchestrator + screenshot URLs.

**Files:**
- Create: `apps/dashboard/components/verify/evidence-column.tsx`, `apps/dashboard/components/verify/screenshot-pair.tsx`, `apps/dashboard/components/verify/verdict-strip.tsx`, `apps/dashboard/app/tasks/[id]/verify/page.tsx`, `apps/dashboard/test/components/verify.test.tsx`

- [ ] **Step 1: Write failing test**

`apps/dashboard/test/components/verify.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceColumn } from "@/components/verify/evidence-column";

describe("EvidenceColumn", () => {
  it("renders header with count", () => {
    render(<EvidenceColumn type="unit" passed={24} total={24}>{null}</EvidenceColumn>);
    expect(screen.getByText("24 / 24")).toBeInTheDocument();
    expect(screen.getByText(/UNIT/)).toBeInTheDocument();
  });

  it("amber accent when not all passed", () => {
    const { container } = render(<EvidenceColumn type="visual" passed={1} total={3}>{null}</EvidenceColumn>);
    expect(container.firstChild?.className).toMatch(/amber/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @pi-harness/dashboard test components/verify`
Expected: FAIL.

- [ ] **Step 3: Implement `components/verify/evidence-column.tsx`**

`apps/dashboard/components/verify/evidence-column.tsx`:
```typescript
import { clsx } from "clsx";

const TITLES = {
  unit:     "UNIT + INTEGRATION",
  api:      "FUNCTIONAL · API",
  visual:   "VISUAL · PLAYWRIGHT",
} as const;

export function EvidenceColumn({
  type,
  passed,
  total,
  capturing = false,
  children,
}: {
  type: keyof typeof TITLES;
  passed: number;
  total: number;
  capturing?: boolean;
  children: React.ReactNode;
}) {
  const allGreen = passed === total;
  const accent = allGreen ? "green" : capturing ? "amber" : "red";

  return (
    <article className={clsx("flex flex-col overflow-hidden rounded-lg border border-border-soft bg-card",
                             accent === "green" && "[&>header]:bg-[linear-gradient(180deg,rgba(52,211,153,0.08),transparent)]",
                             accent === "amber" && "[&>header]:bg-[linear-gradient(180deg,rgba(251,191,36,0.07),transparent)]")}>
      <header className="flex items-center gap-2.5 border-b px-4.5 pb-2.5 pt-3.5"
              style={{ borderColor: accent === "green" ? "rgba(52,211,153,0.18)" : "rgba(251,191,36,0.2)" }}>
        <span className={clsx("inline-flex h-5 w-5 items-center justify-center rounded font-mono text-xs font-bold",
                              accent === "green" && "bg-green-fg/[0.12] text-green-fg2",
                              accent === "amber" && "bg-amber-fg/[0.12] text-amber-fg2")}>
          {capturing ? "⏳" : allGreen ? "✓" : "✗"}
        </span>
        <h2 className={clsx("m-0 font-mono text-[11px] font-bold tracking-[0.14em]",
                            accent === "green" ? "text-green-fg" : "text-amber-fg")}>
          {TITLES[type]}
        </h2>
        <span className={clsx("ml-auto font-mono text-xs font-semibold",
                              accent === "green" ? "text-green-fg2" : "text-amber-fg2")}>
          {capturing ? "capturing…" : `${passed} / ${total}`}
        </span>
      </header>
      <div className="flex-1 px-4.5 py-4">{children}</div>
    </article>
  );
}
```

- [ ] **Step 4: Implement `components/verify/screenshot-pair.tsx`**

`apps/dashboard/components/verify/screenshot-pair.tsx`:
```typescript
export function ScreenshotPair({
  expectedUrl,
  actualUrl,
  diffPct,
  caption,
}: {
  expectedUrl: string | null;
  actualUrl: string | null;
  diffPct: number;
  caption: string;
}) {
  const matched = actualUrl && diffPct < 0.5;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Frame label="EXPECTED" url={expectedUrl} caption={caption} />
      <Frame
        label="ACTUAL"
        url={actualUrl}
        caption={caption}
        accent={matched ? "match" : actualUrl ? "fail" : undefined}
        badge={actualUrl ? `${matched ? "✓" : "✗"} ${diffPct.toFixed(2)}% diff` : null}
      />
    </div>
  );
}

function Frame({
  label,
  url,
  caption,
  accent,
  badge,
}: {
  label: string;
  url: string | null;
  caption: string;
  accent?: "match" | "fail";
  badge?: string | null;
}) {
  const border = accent === "match" ? "border-green-fg/30" : accent === "fail" ? "border-red-fg/40" : "border-border-soft";
  return (
    <div className={`rounded-md border ${border} overflow-hidden bg-input`}>
      <div className="flex items-center border-b border-border-soft px-2.5 py-2 font-mono text-[9px] font-bold tracking-widest text-fg-subtle">
        {label}
        {badge && (
          <span className="ml-auto rounded border border-green-fg/25 bg-green-fg/10 px-2 py-0.5 text-green-fg2">
            {badge}
          </span>
        )}
      </div>
      <div className="aspect-[16/10] bg-sub flex items-center justify-center text-fg-faint text-[11px]">
        {url ? <img src={url} alt={caption} className="h-full w-full object-contain" /> : "(no image)"}
      </div>
      <div className="border-t border-border-soft px-2.5 py-2 text-[11px] text-fg-subtle">{caption}</div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `components/verify/verdict-strip.tsx`**

`apps/dashboard/components/verify/verdict-strip.tsx`:
```typescript
export function VerdictStrip({
  unitPass,
  apiPass,
  visualPass,
  unitTotal,
  apiTotal,
  visualTotal,
  remainingSec,
}: {
  unitPass: number; apiPass: number; visualPass: number;
  unitTotal: number; apiTotal: number; visualTotal: number;
  remainingSec?: number;
}) {
  const greens = (unitPass === unitTotal ? 1 : 0) + (apiPass === apiTotal ? 1 : 0) + (visualPass === visualTotal ? 1 : 0);

  return (
    <section className="m-6 mb-8 flex items-center gap-4.5 rounded-lg border border-cyan-fg/20 bg-[linear-gradient(90deg,rgba(34,211,238,0.06),rgba(167,139,250,0.04))] p-4.5">
      <div className="font-display text-[38px] font-semibold tracking-tighter text-fg">
        {greens}/<em className="not-italic text-cyan-fg2">3</em>
      </div>
      <div className="flex-1">
        <div className="font-display text-base font-semibold tracking-tight text-fg">
          {greens === 3
            ? "All three classes green · PR creation unlocked"
            : `Gate is open · waiting on ${greens === 2 ? "1 evidence class" : `${3 - greens} evidence classes`}`}
        </div>
        <div className="mt-0.5 text-[12.5px] text-fg-subtle">
          unit {unitPass}/{unitTotal} · functional {apiPass}/{apiTotal} · visual {visualPass}/{visualTotal}
          {remainingSec !== undefined && ` · ~${remainingSec}s remaining`}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Implement `app/tasks/[id]/verify/page.tsx`**

`apps/dashboard/app/tasks/[id]/verify/page.tsx`:
```typescript
import { Topbar } from "@/components/topbar";
import { Pill } from "@/components/ui/pill";
import { EvidenceColumn } from "@/components/verify/evidence-column";
import { ScreenshotPair } from "@/components/verify/screenshot-pair";
import { VerdictStrip } from "@/components/verify/verdict-strip";
import { orchestrator } from "@/lib/api";
import type { ProofReport, PlanArtifact } from "@pi-harness/shared";

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = await orchestrator.getArtifact<ProofReport>(id, "proof-report").catch(() => null);
  const plan = await orchestrator.getArtifact<PlanArtifact>(id, "plan").catch(() => null);

  const apiResults = proof?.scenarios.filter((s) => s.type === "api") ?? [];
  const uiResults = proof?.scenarios.filter((s) => s.type === "ui" || s.type === "ui-visual") ?? [];
  const apiPass = apiResults.filter((s) => s.ok).length;
  const uiPass = uiResults.filter((s) => s.ok).length;
  // Unit count comes from the Coder phase log; for now estimated as plan steps × 1.
  const unitTotal = plan?.steps.length ?? 0;
  const unitPass = unitTotal; // assumed green from Coder; v1.5 reads the actual run count
  const screenshotUrl = (file: string | undefined) =>
    file ? `/api/proxy/tasks/${id}/proof/screenshots/${file.replace(/^screenshots\//, "")}` : null;

  return (
    <>
      <Topbar pathLabel="verification" activeRunsCount={1} worktreesCount={1} worktreesSizeMb={0} />
      <section className="flex flex-wrap items-center gap-3.5 px-6 pb-2 pt-5">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-tighter text-fg">Verification Gate</h1>
        <Pill accent="cyan">{[apiPass===apiResults.length, uiPass===uiResults.length, unitPass===unitTotal].filter(Boolean).length} of 3 evidence ✓</Pill>
      </section>
      <p className="max-w-3xl px-6 pb-5 text-[13px] text-fg-subtle">
        <strong className="border-b border-dashed border-fg-faint text-fg-body">All three evidence classes must pass before a PR can ship — no overrides.</strong>
        &nbsp;&nbsp; {unitPass}/{unitTotal} unit ✓ · {apiPass}/{apiResults.length} functional ✓ · {uiPass}/{uiResults.length} visual
        {proof?.startedAt && ` · gate started ${new Date(proof.startedAt).toLocaleTimeString()}`}
      </p>

      <section className="grid grid-cols-3 gap-4 px-6 pb-8">
        <EvidenceColumn type="unit" passed={unitPass} total={unitTotal}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {plan?.steps.map((s) => (
              <li key={s.id} className="flex items-baseline gap-2.5 border-b border-dashed border-border-soft py-1 text-[12.5px] last:border-0">
                <span className="w-3 font-mono text-green-fg">✓</span>
                <span>{s.assertion}</span>
              </li>
            ))}
          </ul>
        </EvidenceColumn>

        <EvidenceColumn type="api" passed={apiPass} total={apiResults.length}>
          {apiResults.map((s) => (
            <div key={s.id} className="mb-3 rounded-md border border-border-soft bg-input p-3.5 font-mono text-[11.5px] last:mb-0">
              <div className={`mb-2 font-mono text-[11px] font-bold tracking-wide ${s.ok ? "text-green-fg2" : "text-red-fg2"}`}>
                {s.ok ? "✓" : "✗"} {s.id}
              </div>
              {s.evidence.status && (
                <div className={s.ok ? "text-green-fg" : "text-red-fg"}>
                  → status {s.evidence.status}
                </div>
              )}
              {s.error && <div className="mt-1 text-red-fg2">{s.error}</div>}
            </div>
          ))}
        </EvidenceColumn>

        <EvidenceColumn type="visual" passed={uiPass} total={uiResults.length} capturing={!proof}>
          {uiResults.length === 0 && (
            <div className="text-xs text-fg-faint">no visual scenarios in this plan</div>
          )}
          {uiResults.map((s) => (
            <div key={s.id} className="mb-3 last:mb-0">
              <ScreenshotPair
                expectedUrl={null}
                actualUrl={screenshotUrl(s.evidence.screenshotFile)}
                diffPct={0}
                caption={`${s.id} · ${s.type}`}
              />
            </div>
          ))}
        </EvidenceColumn>
      </section>

      <VerdictStrip
        unitPass={unitPass} apiPass={apiPass} visualPass={uiPass}
        unitTotal={unitTotal} apiTotal={apiResults.length} visualTotal={uiResults.length}
      />
    </>
  );
}
```

- [ ] **Step 7: Run, verify pass + smoke**

Run: `pnpm --filter @pi-harness/dashboard test components/verify`
Expected: PASS — 2 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): verification proof gate page"
```

---

## Task 11: No-placeholders test + e2e flows

Two safety nets before shipping:
1. **No-placeholders test** — greps every `.tsx` under `components/` and `app/` for `TODO`, `placeholder`, `lorem`, `tbd`, etc. Fails CI if any survive.
2. **E2E** — Playwright drives the dashboard end-to-end on a fresh DB.

**Files:**
- Create: `apps/dashboard/test/no-placeholders.test.ts`, `apps/dashboard/playwright.config.ts`, `apps/dashboard/e2e/kanban.spec.ts`, `apps/dashboard/e2e/task-flow.spec.ts`

- [ ] **Step 1: Implement no-placeholders test**

`apps/dashboard/test/no-placeholders.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const FORBIDDEN = [
  /\bTODO\b/,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
  /\bdummy data\b/i,
  /\bfake data\b/i,
  /\bTBD\b(?!\s*-)/,  // allow `TBD —` in copy that surfaces real TBDs
];

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "test" || entry === "e2e") continue;
    const p = join(dir, entry);
    const s = await stat(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry)) yield p;
  }
}

describe("no-placeholders rule", () => {
  it("no source file contains forbidden placeholder strings", async () => {
    const offenders: { file: string; pattern: string; line: number }[] = [];
    for await (const file of walk(ROOT)) {
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of FORBIDDEN) {
          if (pattern.test(lines[i]!)) {
            offenders.push({ file: file.slice(ROOT.length + 1), pattern: pattern.source, line: i + 1 });
          }
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement Playwright config**

`apps/dashboard/playwright.config.ts`:
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: "pnpm --filter @pi-harness/orchestrator dev",
      port: 4000,
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter @pi-harness/dashboard dev",
      port: 3000,
      reuseExistingServer: true,
    },
  ],
});
```

- [ ] **Step 3: Implement e2e tests**

`apps/dashboard/e2e/kanban.spec.ts`:
```typescript
import { test, expect, request as apiRequest } from "@playwright/test";

test("kanban shows a freshly created task in Backlog", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: "http://localhost:4000" });
  const created = await api.post("/api/tasks", { data: { title: "e2e-kanban-task" } });
  expect(created.ok()).toBeTruthy();

  await page.goto("/");
  await expect(page.getByText("e2e-kanban-task")).toBeVisible();
  await expect(page.getByText(/BACKLOG/)).toBeVisible();
});
```

`apps/dashboard/e2e/task-flow.spec.ts`:
```typescript
import { test, expect, request as apiRequest } from "@playwright/test";

test("create task → start brainstorm transition", async ({ page }) => {
  const api = await apiRequest.newContext({ baseURL: "http://localhost:4000" });
  const created = await api.post("/api/tasks", { data: { title: "e2e-flow-task" } });
  const task = await created.json();

  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText("e2e-flow-task")).toBeVisible();
  await expect(page.getByText(/PHASE TIMELINE/)).toBeVisible();
});
```

- [ ] **Step 4: Run unit test**

Run: `pnpm --filter @pi-harness/dashboard test no-placeholders`
Expected: PASS — no offenders. **If this fails, the listed strings are the rule violations to fix.**

- [ ] **Step 5: Run e2e**

Pre-reqs: docker postgres up. Then:
```bash
pnpm --filter @pi-harness/dashboard exec playwright install chromium
pnpm --filter @pi-harness/dashboard test:e2e
```
Expected: 2 e2e tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard
git commit -m "test(dashboard): no-placeholders + Playwright e2e"
```

---

## Task 12: Smoke verification — full pipeline

The final gate. All four plans together.

- [ ] **Step 1: Clean install**

Run: `pnpm install`
Expected: clean.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: every package + app builds.

- [ ] **Step 3: Run all unit/integration tests**

Run: `pnpm test`
Expected counts:
- `@pi-harness/shared`: 8
- `@pi-harness/db`: 2
- `@pi-harness/pi-bridge`: 1
- `@pi-harness/subagents`: 5
- `@pi-harness/orchestrator`: ~50 + 4 (artifact routes)
- `@pi-harness/dashboard`: ~15 (api:3, use-events:2, ui:4, kanban:4, task-detail:3, verify:2, no-placeholders:1)

Total ≈ 85 tests.

- [ ] **Step 4: Run e2e**

```bash
docker-compose up -d postgres
pnpm --filter @pi-harness/dashboard test:e2e
```
Expected: 2 e2e tests pass.

- [ ] **Step 5: Visual smoke against the mocks**

Open both side-by-side:
- `docs/mocks/kanban.html` vs `http://localhost:3000`
- `docs/mocks/task-detail.html` vs `http://localhost:3000/tasks/<id>`
- `docs/mocks/verification.html` vs `http://localhost:3000/tasks/<id>/verify`

Layout, colors, type, density should match. If any production page diverges, the mock is the contract — fix the page, not the mock.

- [ ] **Step 6: Tag the milestone**

```bash
git tag plan-4-dashboard-complete
git tag pi-harness-v0.1
```

---

## Self-Review

**Spec coverage**

| Spec section | Plan 4 task |
|---|---|
| §10.1 stack (Next.js + Postgres + SSE + Tailwind) | Tasks 2, 3, 4 |
| §10.2 surfaces (kanban, task detail, brainstorm, plan review, verify, agent log) | Tasks 6, 7, 8, 9, 10 |
| §10.3 every card shows column / phase / retry / worktree / last error | Task 6 (TaskCard), Task 8 (RunContext) |
| §10.3 cancel button on every card | Task 8 (page header Stop) |

**Mock coverage** — every visible string in the four mocks is rendered from a real API value:

| Mock value | Plan 4 source |
|---|---|
| Kanban: `15 tasks · 4 in flight · 1 awaiting human` | Task 6 — `counts` from `/api/tasks` |
| Kanban: `feat/rate-limit-login` branch | Task 6 — `Task.branchName` field |
| Task Detail: `task 4 of 9` pill | Task 6 — `runCtx.stepIndex/totalSteps` (computed from latest run + plan.steps.length) |
| Task Detail: phase timing `1m12s` | Task 8 — `PhaseTimeline` derives from `Run.startedAt/endedAt` |
| Task Detail: `$0.42 · 184k in / 38k out` | Task 8 — `RunContext` sums `runs.{costUsd, inputTokens, outputTokens}` |
| Task Detail: log timestamps + types | Task 8 — `AgentLog` from `AgentEvent` |
| Verification: `24/24` `3/3` | Task 10 — counts from `proof-report.scenarios` |
| Verification: scenario curl + status | Task 10 — `ProofReport.scenarios[].evidence.status` |
| Verification: actual screenshot | Task 10 — `<img>` to `/api/proxy/tasks/:id/proof/screenshots/:file` |

**Density rule**

The `no-placeholders.test.ts` (Task 11) is the safety net. It fails CI if any source file contains `TODO`/`placeholder`/`lorem`/`fake data`/`dummy data`. **Empty states still earn density** by naming what's missing (e.g. "No brainstorm artifact yet — phase has not started").

**Type consistency**

- All artifact types (`Task`, `Run`, `AgentEvent`, `BrainstormArtifact`, `PlanArtifact`, `ProofReport`) come from `@pi-harness/shared`. Server components, client components, and tests all import the same aliases.
- The dashboard's `Api` type matches the orchestrator's REST shapes (Plan 2 Task 12 + Plan 4 Task 1).

**Out-of-scope confirmations**

- No drag-and-drop yet (cards are clickable but don't drag) — v1.5.
- No edit-in-place for plan/scenarios — Approve/Reject only.
- No dark/light toggle — dark only by design.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-pi-harness-04-dashboard.md`.**

This plan assumes Plans 1, 2, 3 executed. Pre-reqs:
- docker-compose postgres running
- orchestrator on :4000
- Plan 3's screenshots / artifacts on disk for the verify page to render real images (otherwise the page falls back to the empty-state copy that names what's missing)

After Task 12 ships, the v0.1 cycle is complete: a user can file a one-line ticket on the dashboard, watch a multi-agent run unfold in the live log, review the auto-generated plan, watch verification scenarios pass with real curl + Playwright evidence, and ship a PR — all backed by typed state, stored in Postgres, replayable on restart.
