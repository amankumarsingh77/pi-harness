# Dashboard flow

End-to-end walkthrough of the pi-harness dashboard as it stands today. Each surface is described, then how they connect, then what the flow can't do yet.

## Top-level map

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ◆ pi-harness   board · runs · scenarios   │   ● 3 running  ⚠ 1 blocked  ✓ 12 today │
│                                            │   ⌘K search    [+ new task]    main ▾  │
├────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  /                  →  KANBAN BOARD       (all tasks, grouped by phase)            │
│  /runs              →  RUNS LIST          (flat chronological, debug view)         │
│  /scenarios         →  SCENARIO LIBRARY   (reusable scenario templates)            │
│  /tasks/new         →  NEW TASK FORM      (title + description)                    │
│  /tasks/[id]        →  TASK DETAIL        (live phase timeline + log)              │
│  /tasks/[id]/brainstorm  →  BRAINSTORM    (chat + emerging spec)                   │
│  /tasks/[id]/plan        →  PLAN          (preview + scenario editor)              │
│  /tasks/[id]/verify      →  VERIFY        (evidence columns + verdict)             │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
       │                                 ▲
       │ all routes pull state via       │ live updates via SSE
       │ TanStack Query → /api/proxy/*   │ /api/sse/[runId]
       ▼                                 │
┌────────────────────────────────────────────────────────────────────────────────────┐
│ NEXT.JS ROUTE HANDLERS  (server-side proxy to orchestrator on :4000)               │
└────────────────────────────────────────────────────────────────────────────────────┘
```

The dashboard never talks to the orchestrator directly from the browser — every fetch goes through `/api/proxy/[...path]` so the orchestrator URL stays a server secret and CORS stays clean.

### Topbar anatomy

Every chunk earns its space — no decorative elements.

| Chunk | Purpose |
|---|---|
| `◆ pi-harness` | logo doubles as "home" link |
| `board · runs · scenarios` | three top-level surfaces; underline-on-active |
| `● N running` | count of runs in non-terminal phases; pulses when ≥1 |
| `⚠ N blocked` | runs in `verify` with failing scenarios or in `error`; click filters board |
| `✓ N today` | completed-today count |
| `⌘K search` | command palette (jump-to-task, jump-to-run-id, "create task with title…") |
| `[+ new task]` | primary CTA |
| `main ▾` | target branch for new tasks; switchable per-task |

State variants:

```
   normal:   ● 3 running                  (steady cyan)
   active:   ● 3 running ◀ pulsing dot    (run just started/finished)
   trouble:  ⚠ 1 blocked  ◀ amber bg      (needs attention)
   idle:     · idle                       (no runs at all — replaces "0 running")
```

## Flow 1 — Creating a task (Intake → Brainstorm)

Creating a task does **not** start a run. The task sits in the **Intake** column until the user clicks ▶ start. This makes the cost moment (worktree + LLM tokens) explicit and gives a place to fix typos in the description before the brainstorm agent reads it.

```
   USER                 BROWSER                NEXT SERVER             ORCHESTRATOR
    │                     │                       │                        │
    │  click [+ new task] │                       │                        │
    │ ──────────────────► │  /tasks/new           │                        │
    │  title + desc                               │                        │
    │  click Create       │  server action        │                        │
    │ ──────────────────► │  createTask(formData) │  POST /tasks           │
    │                     │ ────────────────────► │ ─────────────────────► │
    │                     │                       │                        │ insert task
    │                     │                       │                        │ status=intake
    │                     │                       │ ◄───────────────────── │ {id}
    │                     │  redirect /tasks/[id] │                        │
    │ ◄────────────────── │ ◄──────────────────── │                        │
    │                                                                      │
    │  …refine on detail page, then click [▶ start]…                       │
    │                                                                      │
    │ ──────────────────► │  startRun(taskId)     │  POST /runs            │
    │                     │ ────────────────────► │ ─────────────────────► │
    │                     │                       │                        │ create worktree
    │                     │                       │                        │ start run loop
    │                     │                       │                        │ → brainstorm
    │                     │                       │ ◄ SSE phase-changed ── │
    │                     │ ◄ card moves column ──│                        │
```

Two endpoints, two moments: `POST /tasks` is cheap (a row), `POST /runs` is expensive (a worktree + a session). Keeping them separate is the whole reason Intake exists as a column.

**Drag-to-start (B)** is a power-user shortcut layered on top — dragging a card from Intake to Brainstorm fires the same `POST /runs` mutation. Not built first, since drag is invisible and first-time users would trigger it accidentally.

## Flow 2 — Kanban board (the home page)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ pi-harness                                                       [+ New task] │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
│ INTAKE   │ BRAIN-   │  PLAN    │  CODE    │ VERIFY   │   PR     │   DONE      │
│  (2)     │ STORM(1) │  (1)     │  (3)     │  (0)     │  (1)     │   (4)       │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │ ┌──────┐ │          │ ┌──────┐ │ ┌──────┐    │
│ │T-104 │ │ │T-101 │ │ │T-098 │ │ │T-093 │ │          │ │T-090 │ │ │T-088 │    │
│ │add   │ │ │ratel │ │ │csv   │ │ │auth  │ │          │ │theme │ │ │login │    │
│ │email │ │ │imit  │ │ │export│ │ │redir │ │          │ │swit  │ │ │bug   │    │
│ │·14m  │ │ │·02m  │ │ │·08m  │ │ │·19m  │ │          │ │·31m  │ │ │·1h   │    │
│ └──────┘ │ │● live│ │ └──────┘ │ │● live│ │          │ └──────┘ │ └──────┘    │
│ ┌──────┐ │ └──────┘ │          │ └──────┘ │          │          │ ┌──────┐    │
│ │T-103 │ │          │          │ ┌──────┐ │          │          │ │T-087 │    │
│ │...   │ │          │          │ │T-092 │ │          │          │ │...   │    │
│ └──────┘ │          │          │ └──────┘ │          │          │ └──────┘    │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
   Column = phase. Card = task. Pulse dot = run currently active in that phase.
   Click card → /tasks/[id]
```

Source of truth: `GET /tasks` returns every task with its latest run + phase. TanStack Query polls + invalidates on SSE "phase-changed" events so cards move columns without a refresh.

The columns are the phases from `phase-chain.ts` — same enum, same order, no separate UI taxonomy. **Intake** is the pre-run state (task created, no run started yet); every other column reflects the latest run's current phase.

### Card variants

A card looks different depending on which column it's in, because the affordances differ.

```
INTAKE card (pre-run)                BRAINSTORM card (running)
┌─────────────────────────┐          ┌─────────────────────────┐
│ T-104                   │          │ T-104           ● live  │
│ add email digest...     │          │ add email digest...     │
│ ─────────────────────── │          │ ─────────────────────── │
│ created 14:01           │          │ brainstorm · 02m        │
│                         │          │ 3 decisions, 2 open     │
│ [▶ start]   [✎] [🗑]    │          │ [open →]                │
└─────────────────────────┘          └─────────────────────────┘
```

After clicking ▶: card stays put for ~1s while `POST /runs` resolves, then the SSE `phase-changed: brainstorm` event fires and TanStack Query moves it to the Brainstorm column. Same mechanism that moves it from brainstorm → plan → code. No special-casing.

### One worktree per **run**, not per task

```
                     TASK T-104 (the user's intent)
                     │
         ┌───────────┼───────────────────┐
         │           │                   │
       run #1      run #2 (retry)      run #3 (retry after PR feedback)
         │           │                   │
   .harness/      .harness/          .harness/
    runs/r_8f3a/   runs/r_a201/       runs/r_b77c/
    └─ branch:     └─ branch:         └─ branch:
       pi/T-104       pi/T-104-r2        pi/T-104-r3
```

Mental model: **task = the goal, run = an attempt at the goal, worktree = the filesystem for that attempt.** Retrying a task creates a new run and a new worktree, so verify's expected-vs-actual comparison stays meaningful and the PR phase produces a fresh branch instead of force-pushing over the previous attempt. The janitor cleans by run id (`r_xxx`), not task id.

## Flow 3 — Task detail (the hub)

This is the page you land on after creating a task. It's the one screen that watches a run live.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← back   T-104 · "add email digest for weekly summary"                           │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PHASE TIMELINE (horizontal, current phase pulses)                               │
│  ●━━━━━━●━━━━━━●━━━━━━○──────○──────○──────○                                     │
│  intake  brain  plan   code   verify pr     done                                 │
│   ✓ 12s   ✓ 2m   ✓ 47s  ▸ live  ·      ·                                         │
│                                                                                  │
│  ┌──── deep-link panels (only the completed/active ones light up) ────┐          │
│  │  [ open brainstorm ] [ open plan ] [ open verify ]                 │          │
│  └────────────────────────────────────────────────────────────────────┘          │
│                                                                                  │
├──────────────────────────────────────────────────┬───────────────────────────────┤
│ AGENT LOG (live, SSE-fed, autoscroll)            │ RUN CONTEXT                   │
│                                                  │                               │
│ 14:02:11  brainstorm   session opened            │ Branch: pi/T-104              │
│ 14:02:14  brainstorm   reading repo layout...    │ Worktree: .harness/runs/...   │
│ 14:02:38  brainstorm   ✓ artifact written        │ Started: 14:01:58             │
│ 14:02:39  plan         session opened            │ Run id: r_8f3a...             │
│ 14:03:25  plan         ✓ artifact written        │                               │
│ 14:03:26  code         session opened            │ Subagents in use:             │
│ 14:03:30  code         editing src/digest/...    │  · plan-author                │
│ 14:03:44  code         ▸ test runner: 18/24      │  · code-implementer           │
│ 14:03:51  code         ▸ test runner: 24/24 ✓    │  · verification-author        │
│  ▼ (scrolls live as events stream)               │                               │
└──────────────────────────────────────────────────┴───────────────────────────────┘
```

- **PhaseTimeline** is driven by the run's phase history; the pulsing dot is the current phase.
- **AgentLog** subscribes to `/api/sse/[runId]` and renders each event as a row. No filtering UI yet — events are flat.
- **RunContext** is static-ish: branch, worktree path, started-at, run id, which subagents the orchestrator picked.

The three "open …" buttons are the deep links into the phase-specific surfaces below. They're disabled until that phase has produced an artifact.

## Flow 4 — Brainstorm surface

```
/tasks/[id]/brainstorm
┌──────────────────────────────────────────────┬───────────────────────────────────┐
│  CHAT PANEL                                  │  EMERGING SPEC                    │
│                                              │                                   │
│  agent ▸ what's the trigger? cron or event?  │  3 decisions · 2 open · 1 unres.  │
│  you   ▸ weekly cron, sunday 9am UTC         │                                   │
│  agent ▸ what fields go in the digest?       │  GOAL                             │
│  you   ▸ unread count, top 5 threads, ...    │  Send a weekly email digest to    │
│  agent ▸ delivery channel — sendgrid?        │  every active user.               │
│                                              │                                   │
│  ┌────────────────────────────────────────┐  │  DECISIONS                        │
│  │ type your reply...                     │  │  ● cron Sunday 09:00 UTC          │
│  └────────────────────────────────────────┘  │  ● digest: unread + top 5 threads │
│                              [send]          │  ● TBD delivery channel           │
│                                              │                                   │
│                                              │  OPEN QUESTIONS                   │
│                                              │  01  bounce / unsubscribe policy? │
│                                              │  02  digest for inactive users?   │
└──────────────────────────────────────────────┴───────────────────────────────────┘
                                                  (this is `EmergingSpec` —
                                                   reads `BrainstormArtifact`)
```

Right column is `EmergingSpec`. The "unresolved" count comes from regex-matching `\bTBD\b` in decisions.

**Known limitation:** chat is currently one-shot per message — no shared session across turns. The screen renders fine but the agent has amnesia between sends.

## Flow 5 — Plan surface

```
/tasks/[id]/plan
┌────────────────────────────────────────────────────┬─────────────────────────────┐
│  PLAN PREVIEW                                      │  SCENARIO EDITOR            │
│                                                    │                             │
│  ## Approach                                       │  ☑ api: GET /digest/preview │
│  Use a node-cron worker triggered Sunday           │     expects 200 + body.html │
│  09:00 UTC. Digest assembled by `DigestBuilder`    │                             │
│  service, delivered via existing SendGrid client.  │  ☑ unit: digest builder     │
│                                                    │     covers empty inbox case │
│  ## Files                                          │                             │
│  · src/digest/builder.ts          (new)            │  ☐ visual: digest email     │
│  · src/digest/cron.ts             (new)            │     baseline preview        │
│  · src/digest/sendgrid-adapter.ts (modify)         │                             │
│  · test/digest/builder.test.ts    (new)            │  [ + add scenario ]         │
│                                                    │                             │
│  ## Risks                                          │  ─────────────────────────  │
│  - cron drift if instance restarts mid-window      │  Verdict gate: ALL must     │
│  - sendgrid rate limit on Sunday morning bursts    │  pass before PR phase.      │
│                                                    │                             │
│                                  [ approve plan ]  │                             │
└────────────────────────────────────────────────────┴─────────────────────────────┘
```

- Left: rendered plan markdown from the plan agent's artifact.
- Right: scenario list, toggleable. Each scenario is one of `api | unit | visual` and ends up driving the verify phase.
- "approve plan" is in the design but not yet wired — currently `phase-chain.ts` auto-advances.

## Flow 6 — Verify surface

```
/tasks/[id]/verify
┌──────────────────────────┬──────────────────────────┬───────────────────────────┐
│  UNIT          24 / 24   │  API           3 / 3     │  VISUAL        2 / 3      │
│  ────────────────────    │  ────────────────────    │  ──── (capturing) ────    │
│                          │                          │                           │
│  ✓ builder empty inbox   │  ✓ GET /digest/preview   │  ┌─ EXPECTED ─┬─ ACTUAL ─┐│
│  ✓ builder 1 thread      │      200, body.html      │  │            │ ✓ 0.12% ││
│  ✓ builder 5 threads     │  ✓ POST /digest/send     │  │ [baseline] │ [render]││
│  ✓ builder >5 threads    │      202, queued         │  │            │         ││
│  ✓ ...                   │  ✓ GET /digest/audit     │  └────────────┴─────────┘│
│                          │      200, list           │                           │
│                          │                          │  ┌─ EXPECTED ─┬─ ACTUAL ─┐│
│                          │                          │  │            │ ✗ 4.81% ││
│                          │                          │  │            │         ││
│                          │                          │  └────────────┴─────────┘│
│                          │                          │                           │
│                          │                          │  ⏳ capturing 3rd...      │
└──────────────────────────┴──────────────────────────┴───────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────────┐
│ VERDICT STRIP                                                                    │
│ ✗ blocked · 1 visual diff > 0.5%   [ promote actual → expected ]   [ retry ]     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Three columns, one per scenario type. Each `EvidenceColumn` accepts `passed/total/capturing` and renders an amber gradient header while capturing (the test asserts the `251,191,36` color — that's the only DOM-visible signal).

`ScreenshotPair` shows expected vs actual side-by-side with a diff% badge; green border if matched, red if not, no border if there's no actual yet. `Frame` falls back to "(no image)" when a baseline doesn't exist — which is *every* run today, since baseline promotion isn't built.

## How state actually flows

```
        ┌─────────────────────────────────────────────────────────┐
        │                  ORCHESTRATOR (:4000)                   │
        │  REST: /tasks /runs /events /artifacts /screenshots     │
        │  SSE:  /events/:runId  (live)                           │
        └──────────────▲──────────────────────▲───────────────────┘
                       │                      │
            REST proxy │                      │ SSE proxy
                       │                      │
        ┌──────────────┴──────────────────────┴───────────────────┐
        │           NEXT.JS DASHBOARD (:3000)                     │
        │                                                         │
        │  app/api/proxy/[...path]/route.ts   ← fetches REST      │
        │  app/api/sse/[runId]/route.ts       ← streams SSE       │
        │                                                         │
        │  lib/queries.ts   ← TanStack Query hooks                │
        │  lib/use-events.ts ← EventSource hook                   │
        │                                                         │
        └──────────────▲──────────────────────────────────────────┘
                       │
                       │ pages call hooks; hooks call /api/* routes
                       │
                       ▼
                   COMPONENTS  (kanban, task-detail, brainstorm, plan, verify)
```

Three patterns and that's it:

1. **Page-level data:** server component reads via TanStack Query during render (initial HTML), client takes over and refetches/invalidates.
2. **Live updates:** `useEvents(runId)` opens an `EventSource` to `/api/sse/[runId]`, dispatches into a reducer, which both updates local UI and invalidates relevant queries.
3. **Mutations:** server actions (`createTask`, future `approvePlan`, future `promoteBaseline`) → orchestrator REST → revalidate.

## Locked decisions (2026-05-08)

- **Intake column with explicit ▶ start** — task creation does not start a run. Drag-to-start is a planned power-user shortcut, not the default.
- **One worktree per run** — `.harness/runs/r_xxx/`, branch `pi/T-NNN[-rN]`.
- **Topbar with live counters** — `running / blocked / today` + `⌘K` palette + branch switcher.
- **Every component must justify its purpose** — no decorative elements; if a component can't articulate the info it carries or the action it enables, it doesn't ship.

## What this flow can't do today

- **No "approve plan" step** — plan auto-advances to code.
- **No "promote actual → expected"** — verify can show diffs but you can't act on them.
- **No multi-turn brainstorm** — every send is a fresh session.
- **No retry / cancel buttons anywhere** — kanban is read-only motion.
- **No filtering, search, or sort** on the board.
- **No artifact diffing across runs** of the same task.
- **No "who is this assigned to / who started it"** — single-user assumption baked in.
- **SSE has no resume on reconnect** — sleep your tab, lose events.
- **`/runs` and `/scenarios` routes don't exist yet** — topbar nav references them.
- **Branch switcher in topbar is design-only** — orchestrator currently assumes `main`.

Each is a real design decision worth thinking through one at a time.
