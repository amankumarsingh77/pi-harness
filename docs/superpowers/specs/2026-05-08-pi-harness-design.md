# pi-harness — Design Doc

**Date:** 2026-05-08
**Status:** Draft, awaiting user review
**Author:** aman + claude

---

## 1. What this is

A multi-agent **coding harness** built on top of `pi.dev`. Tasks are filed on a Kanban-style web dashboard; for each task, a chain of specialized pi subagents brainstorms, plans, implements, verifies, and ships the work as a PR. Every task runs in its own git worktree. The verification gate produces concrete proof — payloads, responses, and screenshots — that the feature actually works, surfaced as artifacts on the task card.

The harness does not reimplement primitives that already exist in the pi ecosystem. It composes them.

### What it is not

- Not a fork of pi.
- Not a clone of `task-factory` or `taskplane`. Those exist, are close to the idea, but neither does workflow-by-task-type, mock-design-in-the-loop, or proof-of-working-with-screenshots as first-class artifacts.
- Not an attempt to ship every workflow in v1 (see §11 — v1 is one vertical slice).

---

## 2. Reuse vs build

| Concern | Source |
|---|---|
| Coding agent runtime | `@earendil-works/pi-coding-agent` (consumed, not modified) |
| Subagent spawning, parallel/chain execution, worktree-per-agent | `pi-subagents` (`nicobailon/pi-subagents`) |
| Research subagent fleet (locator/analyzer/pattern-finder/precedent/claim-verifier/etc.) | **Forked from rpiv-mono `.pi/agents/`**, vendored under `subagents/`, extended with our own |
| Multi-provider LLM API | `@earendil-works/pi-ai` (transitively, via pi) |
| Browser automation for UI verification | `mcp__playwright__*` |
| Web UI primitives (chat panels, agent log streams) | `@earendil-works/pi-web-ui` where it fits |

What we build:

1. **Dashboard** — Next.js + Postgres + SSE.
2. **Orchestrator** — Node service that owns the task state machine, dispatches pi-subagent runs, streams events to the dashboard.
3. **Workflow Router** — task-type → phase chain.
4. **Planning Agent** — orchestrates the rpiv-style research fleet then synthesizes a plan.
5. **Verifier Agent** — runs Verification Scenarios, captures evidence.
6. **New subagents** to extend the rpiv fleet — `proof-capture`, `screenshot-taker`, `mock-designer` (v2), `verification-author` (drafts scenarios for the gate).

---

## 3. Top-level architecture

```
                  ┌──────────────────────────────────┐
                  │  Dashboard (Next.js)             │
                  │  - Kanban board                  │
                  │  - Task detail / proof panel     │
                  │  - Brainstorm chat               │
                  │  - Plan/scenario approval forms  │
                  └────────────┬─────────────────────┘
                  REST + SSE    │
                  ┌─────────────┴────────────────────┐
                  │  Orchestrator (Node)             │
                  │  - Task state machine            │
                  │  - Workflow Router               │
                  │  - Pi-subagent dispatcher        │
                  │  - Worktree manager              │
                  │  - Event stream → SSE            │
                  └────────────┬─────────────────────┘
                               │ spawns
                  ┌────────────┴─────────────────────┐
                  │  pi sessions (per phase)         │
                  │  ── Brainstorm Agent             │
                  │  ── Planning Agent               │
                  │  │   └── fanout: rpiv subagents  │
                  │  ── Coder Agent (TDD)            │
                  │  ── Verifier Agent               │
                  │  │   └── Playwright + curl       │
                  │  ── PR Agent                     │
                  └────────────┬─────────────────────┘
                               │ writes
                  ┌────────────┴─────────────────────┐
                  │  Postgres + .harness/runs/<id>/  │
                  │  - run state, events, artifacts  │
                  │  - proof-report.md, screenshots  │
                  └──────────────────────────────────┘
```

---

## 4. Kanban states

Columns left to right:

| Column | Owner | Exit condition |
|---|---|---|
| **Backlog** | user | user drags to Brainstorm |
| **Brainstorming** | Brainstorm Agent | brainstorm artifact approved by user |
| **Planning** | Planning Agent | plan + verification scenarios approved by user |
| **Executing** | Coder Agent | coder reports done |
| **Verifying** | Verifier Agent | all scenarios pass |
| **Verification Failed** | (queue) | user triages, kicks back to Executing or edits scenarios |
| **Ready to Ship** | PR Agent | PR opened |
| **Done** | — | terminal |

Concurrency cap is configurable; default 2 tasks in `Executing` simultaneously (each in its own worktree).

---

## 5. Worktree-per-task

Every task that leaves Backlog gets a dedicated git worktree at `.harness/worktrees/<task-id>/`, branched from `main` at task-pickup time. All agents for that task run with `cwd` set to the worktree. We delegate the worktree mechanics to `pi-subagents`' `worktree: true` option rather than reimplementing.

A task that fails verification keeps its worktree until the user resolves it (so kick-backs to Coder reuse the in-flight branch). On `Done`, the worktree is removed; the branch stays remote until PR is merged.

---

## 6. Workflow Router

A workflow is a typed phase chain. v1 ships exactly **one** workflow (`backend-feature`); v2+ adds `ui-feature`, `refactor`, `bugfix`, `data-migration`.

**v1 chain (`backend-feature`):**

```
Brainstorm → Plan → Code (TDD) → Verify → Commit → PR
```

**Routing decision (v1):** Planner emits a `suggested_workflow` field. With only one workflow available, the dashboard shows it as a confirmation step but the value is fixed. The plumbing is in place so v2 can drop in alternatives without refactoring.

**Routing decision (v2+):** the Planning Agent has a `route` step before plan synthesis: it inspects the brainstorm artifact and the touched code paths and emits `suggested_workflow`. The dashboard renders this on the task card with Accept / Override controls. User picks before Coder starts. No silent autonomous routing.

---

## 7. The Planning Agent (the core of this doc)

The planner does **not** write code, talk to the user, or decide workflow alone. It receives an approved brainstorm artifact and produces a codebase-grounded executable plan that the Coder Agent can follow without re-investigating.

### 7.1 Phase pipeline

| Phase | Subagent | Mode | Purpose |
|---|---|---|---|
| 1. Scope | `scope-tracer` | one call | bounds the investigation; emits 5–10 dense numbered questions citing ≥3 code artifacts each |
| 2a. Locate | `codebase-locator` | parallel | where relevant files live |
| 2b. Patterns | `codebase-pattern-finder` | parallel | concrete examples to model after (rpiv's flagship feature) |
| 2c. Analyze | `codebase-analyzer` | parallel | how touchpoints work today |
| 2d. Connect | `integration-scanner` | parallel | inbound/outbound edges (blast radius) |
| 2e. Tests | `test-case-locator` | parallel | existing coverage in the area |
| 3a. Precedent | `precedent-locator` | parallel | past similar changes + follow-up fixes |
| 3b. Peer | `peer-comparator` | parallel, optional | only when a clear sibling entity exists |
| 4. Synthesize | (planner main) | sequential | merge findings into Planning Artifact |
| 5. Verify claims | `claim-verifier` | one call | adversarially tag every plan claim Verified/Weakened/Falsified |
| 6. Author scenarios | `verification-author` (new) | one call | draft executable Verification Scenarios for the gate |
| 7. Revise | (planner main) | sequential | act on falsified claims; finalize |

Phases 2 and 3 fan out concurrently inside their own pi child sessions via `pi-subagents`. Synthesis and revision are in the planner's parent session.

### 7.2 Planning Artifact

Saved to `.harness/runs/<task-id>/plan.md`. Sections:

1. **Goal** — copied from brainstorm, restated tersely.
2. **Patterns to follow** — file:line examples annotated "model after this", from `codebase-pattern-finder`.
3. **Touchpoints** — files to create/modify, grouped by layer, each with the analyzer's findings inline.
4. **Blast radius** — what will be affected (`integration-scanner`).
5. **Precedent warnings** — "last time this changed, X broke" (`precedent-locator`).
6. **Step-by-step plan** — ordered, testable steps. Each step names exact files, the pattern to follow, and the assertion that proves it's done.
7. **Verification Scenarios** — see §8.
8. **Out of scope** — explicit anti-list.
9. **Suggested workflow** — input to the router (v2+).

### 7.3 New subagents

- **`verification-author`** — drafts executable scenarios from the plan and brainstorm. Output is the YAML in §8.1.
- **`proof-capture`** — invoked by Verifier; runs a single scenario and writes its slice of `proof-report.md`.
- **`screenshot-taker`** — Playwright wrapper that captures full-page or element screenshots into `.harness/runs/<id>/proof/screenshots/`.

These get vendored alongside the rpiv-forked agents under `subagents/<name>.md`, with the same isolated/tool-allowlist conventions.

---

## 8. Verification gate

The most novel and most failure-prone part. Strategy: make "passing" mean **the feature was exercised end-to-end and produced the expected output**, not just "tests pass."

### 8.1 Verification Scenarios

Authored by `verification-author` (Phase 6 of planning) and **reviewed by the user** in the dashboard before Coder starts. Hybrid model: planner drafts, user can approve as-is or edit inline.

```yaml
# .harness/runs/<task-id>/verification.yaml
scenarios:
  - id: api-create-user
    type: api
    name: "POST /users accepts valid payload"
    setup:
      - bash: ./scripts/seed-test-db.sh
    request:
      method: POST
      url: http://localhost:3000/users
      body: { email: "test@example.com", name: "Test" }
    expect:
      status: 201
      body_contains: ["id", "email"]

  - id: ui-login-success
    type: ui
    name: "Login form submits and redirects to dashboard"
    steps:
      - navigate: http://localhost:3000/login
      - fill: { selector: "[name=email]", value: "user@example.com" }
      - fill: { selector: "[name=password]", value: "hunter2" }
      - click: "button[type=submit]"
      - wait_for_url: "**/dashboard"
    expect:
      url_matches: "**/dashboard"
      screenshot: "login-success-dashboard.png"
```

Three scenario types in v1: `api` (curl), `ui` (Playwright steps), `ui-visual` (screenshot only).

### 8.2 Verifier Agent

Spins up the app inside the worktree using a project-local convention (`.harness/start.sh` or `npm run dev` if absent), waits for health, runs each scenario sequentially, captures evidence:

```
.harness/runs/<task-id>/proof/
├── proof-report.md           # markdown report, rendered in dashboard
├── scenarios.json            # structured pass/fail per scenario
├── screenshots/
│   ├── login-success-dashboard.png
│   └── ...
└── responses/
    └── api-create-user.json
```

The proof panel on the task card renders `proof-report.md` inline with screenshots as images and JSON payloads collapsed by default.

### 8.3 Failure handling

Hard fail with retry cap.

- Scenario fails → task moves to `Verification Failed`.
- Orchestrator immediately kicks the task back to `Executing` with the failure context (scenario id, expected vs actual, last response, last screenshot) injected as a new turn for the Coder Agent.
- Retry counter increments. **Cap = 2 retries** (configurable per workflow).
- After cap exhausted, task stays in `Verification Failed` and waits for human triage. The user can: (a) edit the scenario in the dashboard and re-run verify, (b) write a guidance note and bounce back to Coder, (c) abandon the task.

This avoids the failure mode where a fundamentally-wrong task burns money in an infinite retry loop.

### 8.4 What "passing" means

Three classes of evidence, all required for green:

1. **Test evidence** — project's existing `npm test` / equivalent passes.
2. **Functional evidence** — every `api`/`ui` scenario produces its expected payload/url.
3. **Visual evidence** — every `ui` and `ui-visual` scenario produces the declared screenshot.

Missing any of the three blocks the gate.

---

## 9. The agent fleet

### 9.1 Vendored from rpiv-mono (forked into `subagents/`)

Locator: `codebase-locator`, `test-case-locator`, `thoughts-locator`
Analyzer: `codebase-analyzer`, `thoughts-analyzer`
Patterns/precedent: `codebase-pattern-finder`, `precedent-locator`
Verifier/auditor: `claim-verifier`, `diff-auditor`, `peer-comparator`
Connectivity: `integration-scanner`
Scope: `scope-tracer`
Web: `web-search-researcher`

License/attribution preserved at the top of each vendored file.

### 9.2 New subagents (ours)

- `verification-author` — drafts Verification Scenarios YAML.
- `proof-capture` — executes a single scenario, writes its evidence.
- `screenshot-taker` — Playwright screenshot helper.
- `mock-designer` — *(v2)* generates mock options for UI tasks.

### 9.3 Phase-driver agents (parent pi sessions)

These are not "subagents" — they're the top-level pi session for each phase, each with a tight prompt:

- **Brainstorm Agent** — chats with user via dashboard, asks 1–3 clarifying questions max, emits `brainstorm.md`.
- **Planning Agent** — orchestrates §7 pipeline.
- **Coder Agent** — TDD-style implementation against the plan; consumes verification failures as new turns on retry.
- **Verifier Agent** — orchestrates `proof-capture` per scenario.
- **PR Agent** — runs `git commit` (conventional commits) and `gh pr create` with body templated from the plan + proof-report.

---

## 10. Dashboard

### 10.1 Stack

- **Next.js** (App Router) for server-rendered React + API routes.
- **Postgres** for task state, run history, agent events.
- **Server-Sent Events** for streaming live agent output to open task cards.
- **Tailwind + shadcn/ui** for board/cards/forms.
- **Drizzle** as the ORM (lightweight, typed).

### 10.2 Surfaces

| Surface | Purpose |
|---|---|
| Board view | The kanban with columns from §4. Drag to move (Backlog→Brainstorming only; other transitions are agent-driven). |
| Task detail panel | Tabs: Brainstorm chat, Plan, Verification Scenarios (editable), Proof Report, Live Agent Log, Worktree info. |
| Brainstorm chat | User ↔ Brainstorm Agent over SSE. |
| Plan review | Renders `plan.md`. Buttons: Approve / Request changes (returns to planner with note). |
| Scenarios review | Renders `verification.yaml` in a form. Inline editing per scenario. Approve to release Coder. |
| Proof panel | Renders `proof-report.md` with screenshots inline. Pass/fail badges per scenario. |
| Agent log | SSE-streamed turn-by-turn output of the active phase. |

### 10.3 "Easy to manage" requirements

- Every task card shows: column, current phase, retry count, worktree path, last error.
- Global "agents running" indicator with live count + cost.
- Cancel button on every card (kills the active pi session, leaves worktree intact for inspection).
- Bulk actions: archive Done, retry all in `Verification Failed`.
- Cost & token usage panel reusing patterns from `pi-cost-dashboard`.

---

## 11. v1 scope

**One vertical slice, fully working.**

In:

- The `backend-feature` workflow only.
- Full chain: Brainstorm → Plan → Code → Verify → PR.
- Worktree-per-task with cleanup.
- Dashboard with all surfaces in §10.2 (kanban, detail panel, plan/scenario review, proof panel, agent log).
- Vendored rpiv subagent fleet + our new ones (`verification-author`, `proof-capture`, `screenshot-taker`).
- Verification gate with all three evidence classes (§8.4).
- Hard-fail-with-2-retry-cap.
- Conventional commits + `gh pr create`.

Out (deferred to v2+):

- `ui-feature` workflow with mock-designer step.
- `refactor`, `bugfix`, `data-migration` workflows.
- Workflow Router with multiple alternatives (the plumbing is there; the alternatives are not).
- Multi-tenant or remote deployment.
- Sandboxing (gondolin/nono integration).

This ships something genuinely useful in weeks, not months. The proof-of-working gate is the differentiator and it's in v1.

---

## 12. Repo layout (proposed)

```
pi-harness/
├── apps/
│   └── dashboard/                 # Next.js app
├── packages/
│   ├── orchestrator/              # Node service: state machine, dispatcher
│   ├── shared/                    # types, schemas (zod), event contracts
│   └── pi-bridge/                 # thin wrapper over @earendil-works/pi + pi-subagents
├── subagents/                     # vendored rpiv + ours; one .md per agent
│   ├── _vendored/                 # forked-from-rpiv with attribution
│   └── ours/
├── docs/
│   └── superpowers/specs/         # this doc + downstream plans
└── .harness/                      # runtime: worktrees, runs, artifacts (gitignored)
```

Monorepo with `pnpm` + `turbo`.

---

## 13. Open risks

1. **Scenario authoring quality.** If `verification-author` produces weak scenarios, the gate is theater. Mitigation: user reviews scenarios before Coder runs (§8.1); `claim-verifier` also runs over scenario assumptions in v1.5.
2. **App-startup convention.** Every project starts differently. v1 requires `.harness/start.sh` or detects `npm run dev`. v2 adds language-aware detection.
3. **Cost.** A full run is brainstorm + ~7 parallel research subagents + plan + claim-verifier + coder + verifier + retry. We need a per-task token budget surfaced live in the dashboard, with a hard cap that pauses the run.
4. **Pi-subagents API stability.** Vendoring the rpiv prompts isolates us from rpiv churn but `pi-subagents` is still upstream. Pin a version; don't auto-update.
5. **Worktree leakage.** A task that crashes mid-run can leave orphan worktrees. Orchestrator runs a janitor on startup that reconciles worktrees against the task DB.
6. **Single workflow in v1 hides routing bugs.** We won't shake out the router until v2. Mitigation: the router is wired up and the planner emits `suggested_workflow` even though there's only one option, so the integration surface is exercised end-to-end.

---

## 14. Out of scope (firm)

- Replacing or forking `pi` or `pi-subagents`.
- Cloud-hosted multi-user mode.
- Built-in sandboxing (use `gondolin`/`nono` externally if needed).
- Self-hosting LLM providers.
- A plugin marketplace.

---

## 15. References

- pi.dev docs — https://pi.dev/docs/latest
- earendil-works/pi monorepo — https://github.com/earendil-works/pi
- pi-subagents — https://github.com/nicobailon/pi-subagents
- rpiv-mono — https://github.com/juicesharp/rpiv-mono
- task-factory (closest kanban precedent) — https://github.com/patleeman/task-factory
- taskplane (closest multi-agent precedent) — https://github.com/HenryLach/taskplane
- awesome-pi-agent — https://github.com/qualisero/awesome-pi-agent
- rpiv-mono agent prompts (vendored from) — `/Users/amankumar/Documents/GitProjects/pi-browser-harness/.pi/agents/`
