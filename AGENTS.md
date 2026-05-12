# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A multi-agent coding harness built on pi.dev. A user files a task, an orchestrator drives a phase chain (`brainstorm → plan → code → verify → pr`), each phase is a vendored pi-subagent running in its own git worktree, and progress is watched live in a Next.js dashboard. Design spec: `docs/superpowers/specs/2026-05-08-pi-harness-design.md`. Dashboard flow + locked decisions: `docs/dashboard-flow.md`. Static UI mocks: `docs/mocks/`.

## Operating principles

These are not aesthetic preferences — they're the rules for how work gets done here.

1. **Build piece by piece. Don't one-shot.** This is a deliberately phased project. Plans live in `docs/superpowers/plans/` (numbered 01–04). The user wants each surface designed, mocked, agreed, then built. If a request seems to span multiple surfaces or phases, push back and propose a split.

2. **Every component, endpoint, and UI string must justify its existence.** No decorative elements, no filler text, no "useful later" abstractions. If you can't articulate the info a component carries or the action it enables, don't build it. This applies to backend just as much as frontend — no speculative endpoints, no parameters "in case we need them."

3. **Dashboard aesthetic is Linear.com.** Calm, monochrome surfaces. Color is reserved for *status signal*, never decoration. Hairline borders only (`var(--color-line)` rgba). No tinted backgrounds, no gradients on cards, no left-rail color stripes per item, no shadows. Hierarchy comes from typography (size, weight, foreground vs muted), not chrome. The token set lives in `apps/dashboard/app/globals.css`.

4. **Don't put live shell commands or action snippets on the kanban board.** Status-at-a-glance only. The "what's the agent doing right now" detail belongs on the task detail page.

5. **Use the frontend-design skill before any dashboard component work.** Even small changes. The skill is invoked via the `Skill` tool. Study Linear's equivalent first; copy the *discipline*, not the pixels.

6. **Code review runs once at the end of all phases**, never between them. The user has explicitly asked us not to interrupt phase work with mid-flight review agents.

7. **Speculative or hypothetical features are out of scope.** No backwards-compat shims for code we wrote ourselves, no feature flags for unknown futures, no validation for inputs that can't happen. Trust internal code; only validate at system boundaries.

## Stack & topology

- **Monorepo:** pnpm 9 + Turborepo. Node ≥ 22. TypeScript strict (`exactOptionalPropertyTypes: true`) — pass conditional spreads, not `T | undefined`, to optional props.
- **Apps:** `apps/orchestrator` (Fastify 5 + SSE) and `apps/dashboard` (Next.js 15 App Router + React 19 + Tailwind v4 inline-theme + TanStack Query 5).
- **Packages:** `@pi-harness/shared` (types + Zod schemas), `@pi-harness/db` (Drizzle ORM, Postgres 16), `@pi-harness/pi-bridge` (wraps `@earendil-works/pi-coding-agent`). The generic `createAgentSession` (`packages/pi-bridge/src/agent-session.ts`) is real; brainstorm uses it. The legacy `createSession` / `runSubagent` paths in `_mock.ts` and `session.ts` still back plan/code/verify until each migrates.
- **Subagents:** vendored prompts in `subagents/_vendored/` (13 files from rpiv-mono) and `subagents/ours/` (3 originals). Loader at `subagents/index.ts` validates `EXPECTED_OUR_AGENTS` at boot.
- **Postgres** runs via **podman** (no docker on this machine). Compose file is `compose.yml` (Compose Spec name); bring it up with `pnpm db:up` (which runs `podman compose up -d postgres`, port `54330`). `podman compose` is a thin wrapper that delegates to `podman-compose` when `docker-compose` isn't installed — both `podman` and `podman-compose` must be on PATH. Requires `podman machine start` on macOS before the first `db:up`.

## Common commands

From the repo root:

```bash
pnpm install
pnpm db:up                            # podman compose up -d postgres
pnpm db:migrate                       # apply Drizzle migrations
pnpm db:generate                      # regenerate after schema change

pnpm typecheck                        # turbo, all packages
pnpm test                             # turbo, all packages
pnpm build                            # turbo, all packages
pnpm lint
```

Per-package targeting:

```bash
pnpm --filter @pi-harness/orchestrator start
pnpm --filter @pi-harness/dashboard dev
pnpm --filter @pi-harness/dashboard test
pnpm --filter @pi-harness/dashboard exec next build
pnpm --filter @pi-harness/orchestrator test -- path/to/file.test.ts
```

Single-test runs use vitest's path arg. The orchestrator's vitest config forces serial execution (`pool: forks`, `singleFork: true`, `fileParallelism: false`) because db-touching tests truncate shared Postgres tables — do not change this. Dashboard vitest excludes `**/e2e/**`; Playwright runs those separately.

## Architecture (the parts you have to read multiple files to understand)

**The phase chain is the spine.** Source of truth is `apps/orchestrator/src/domain/phase-chain.ts` and `state-machine.ts`. The `TASK_STATUSES` enum in `packages/shared/src/types/task.ts` mirrors phases — same enum, same order, no separate UI taxonomy. The dashboard's kanban columns are this enum, in order. If you add a phase, you change one file and the columns/cards follow.

**One worktree per *run*, not per task.** A task can be retried; each retry is a new run with its own `.harness/runs/r_xxx/` directory and its own branch (`pi/T-NNN[-rN]`). The janitor cleans by run id. This is critical for verify's expected-vs-actual diffs to remain meaningful across retries. Run-loop wiring lives in `apps/orchestrator/src/runner/run-loop.ts`; worktree management in `adapters/worktree.ts`.

**Worktree paths are canonicalized.** macOS `os.tmpdir()` returns `/var/folders/...` but git emits `/private/var/...`. `WorktreeManager` resolves both via `realpathSync` at constructor *and* at `list()` time. Don't bypass this — tests will silently return `[]` on Mac.

**Dashboard never talks to the orchestrator from the browser.** All REST goes through `app/api/proxy/[...path]/route.ts`; SSE through `app/api/sse/[runId]/route.ts`. The orchestrator URL is a server-only env var. Don't add direct fetches from client components.

**Live updates flow through SSE → reducer → query invalidation.** `lib/use-events.ts` opens an `EventSource`, dispatches into a reducer, which both updates local UI and invalidates the matching TanStack Query cache. Don't poll. Don't bypass the proxy.

**Mutations are server actions, not client fetches.** See `app/tasks/new/actions.ts` for the pattern. Server action → `orchestrator.<call>` → `redirect`/`revalidate`. Use `import type { Route } from "next"` and cast: `redirect(\`/tasks/${id}\` as Route)` — required by `typedRoutes`.

**Dashboard tokens are Tailwind v4 `@theme` variables** (`apps/dashboard/app/globals.css`). Status colors are `--color-st-{idle,progress,review,blocked,shipping,done}`. Hairline borders are `--color-line` (rgba), not solid `--color-border-soft`. Card surfaces are `--color-card` and `--color-card-hover`. Use these instead of arbitrary hex.

**The kanban status icons are SVGs, not Unicode.** See `apps/dashboard/components/kanban/status-icon.tsx`. Six kinds (intake, progress, review, blocked, shipping, done). The `progress` kind plays a 2.4s opacity tick when its parent is `live`; no other animation on the board. Don't add Unicode geometric shapes (`●◐⊘`) — they'll render inconsistently against the SVG set.

## Dashboard patterns (where things go)

One answer per question — don't invent a second location.

- **Server-only data:** `lib/server/api.ts` (orchestrator instance) and `lib/server/_fixtures/*` (mocks). Both top with `import "server-only"`. Never import these from a `'use client'` file.
- **Client data layer:** `lib/client/queries.ts` (TanStack wrappers, hits `/api/proxy/*`). The shared `api()` factory + `Api`/`ApiError` types live in `lib/api/index.ts` and are imported by both sides.
- **UI-only types** (mock shapes, view models): `types/mocks.ts`. Types may cross the server→client boundary; values may not.
- **Mutations:** colocated `actions.ts` next to the route. Always end with `revalidatePath(...)` (or `revalidateTag`) + `redirect(... as Route)`.
- **Route conventions:** every route ships `loading.tsx` + `error.tsx`. Dynamic `[id]` routes also ship `not-found.tsx` and call `notFound()` when the orchestrator returns `ApiError(404)`.
- **Metadata is required:** every `page.tsx` exports `metadata` or `generateMetadata`. Title pattern: `${id} · ${phase} · pi-harness`.
- **Parallel server fetches:** RSC pages must `Promise.all` independent awaits. Sequential awaits require a `// waterfall: <reason>` comment.
- **Route handlers** (`app/api/**/route.ts`) explicitly set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`. No defaults.
- **Navigation hooks** (`usePathname`, `useSearchParams`) live in a small `'use client'` child wrapped in `<Suspense>` by a server-component parent — otherwise the whole route bails to CSR. See `components/topbar.tsx` + `topbar-nav.tsx`.

## Brainstorm phase

Implemented end-to-end against the real `@earendil-works/pi-coding-agent` SDK. See:

- Design: `docs/superpowers/specs/2026-05-09-brainstorm-real-pi-design.md` (current); `docs/superpowers/specs/2026-05-09-brainstorm-phase-design.md` (superseded for the agent driver).
- Plan: `docs/plans/brainstorm-real-pi/`
- On task entry: branch `pi/T-NNN`, worktree at `.harness/worktrees/<taskId>/`, `chore(<taskId>): brainstorm scaffolding` commit lays down `design.md` + `spec.md` with `status: draft` frontmatter at `<worktree>/.harness/<taskId>/`.
- Q&A: `apps/orchestrator/src/agents/brainstorm.ts` opens or resumes a real pi agent session per tick. The system prompt is `subagents/ours/brainstorm.md`; phase-specific custom tools `submit_questions` and `mark_ready` live in `apps/orchestrator/src/agents/brainstorm-tools.ts`. `BrainstormEventBus` dual-writes every event to JSONL (`brainstorm.jsonl`) and EventStore (for live SSE).
- Resume: pi's session JSONL is persisted at `<worktree>/.harness/<taskId>/pi-session.jsonl`; each tick reopens it so orchestrator restarts don't lose context.
- Per-phase model config: `effectiveConfig = { ...DEFAULT_PHASE_MODELS[phase], ...task.phaseModels[phase] }` (`packages/shared/src/config/phase-models.ts`). Defaults to crofai / kimi-k2.6 for every phase. CrofAI is registered as a custom provider via `ModelRegistry.registerProvider` in `packages/pi-bridge/src/agent-session.ts`; the curated model list lives in `packages/pi-bridge/src/providers/crofai.ts`.
- Approval: `awaitingApproval=true` is the brainstorm sub-state — task sits in `brainstorming` until the user clicks Approve (advances to `planning`, marks both artifacts `approved`) or Request changes (appends revision event, agent re-walks).

### Live exercises

`PI_LIVE=1 pnpm --filter @pi-harness/orchestrator test brainstorm.live` runs `apps/orchestrator/test/agents/brainstorm.live.test.ts`. Requires `.env.harness` at repo root with `CROFAI_API_KEY=...` (default) or whichever provider's key matches the test's configured `phaseModel` — `ANTHROPIC_API_KEY=...` works if the test is pointed at the anthropic provider. See `.env.harness.example`. The file is excluded from default `pnpm test` via the `**/*.live.test.ts` exclude in `apps/orchestrator/vitest.config.ts`.

## Known gaps (intentionally deferred)

These are documented and not bugs:

- **Plan / code / verify still go through the legacy `createSession` mock** (`packages/pi-bridge/src/_mock.ts` + `session.ts`). Brainstorm migrated to the real generic `createAgentSession`; the other phases will follow one slice at a time.
- **`@pi-harness/subagents` `resolveAgentPath` doesn't work in dist mode** — `.md` prompt files aren't copied into `dist/`. The brainstorm agent works around this by resolving its own prompt path from `import.meta.url` (`apps/orchestrator/src/agents/brainstorm.ts`). Fixing the loader to ship the markdown is its own slice.
- **PR phase needs `gh auth login`** on the host.
- **Visual scenarios need `npx playwright install chromium`.**
- **Dashboard `/runs` and `/scenarios` routes don't exist** — the topbar nav references them as placeholders. Branch switcher in topbar is also visual-only.
- **No "approve plan" gate** — only brainstorm has an approval gate today; `phase-chain.ts` auto-advances out of plan/code/verify.
- **No "promote actual → expected"** baseline action on verify.
- **SSE has no resume on reconnect** (no `lastEventId` handling).
- **Plan phase still reads the legacy `BrainstormArtifact`** (`brainstorm.json` / `brainstorm.md` under `runsDir`). Brainstorm now writes branch-scoped `design.md` / `spec.md`; migrating plan to read those is a follow-up.

If you find yourself solving one of these mid-task, stop and split it into its own piece per principle 1.

## Where things live

- Locked dashboard design decisions: `docs/dashboard-flow.md`
- Static HTML mocks (Linear-faithful): `docs/mocks/kanban-cards.html` and siblings
- Phase plans (numbered): `docs/superpowers/plans/2026-05-08-pi-harness-0{1..4}-*.md`
- Top-level design spec: `docs/superpowers/specs/2026-05-08-pi-harness-design.md`
- Subagent attribution: `subagents/ATTRIBUTION.md`
