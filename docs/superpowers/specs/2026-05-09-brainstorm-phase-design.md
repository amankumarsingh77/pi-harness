# Brainstorm Phase — Design Doc

**Status:** draft
**Date:** 2026-05-09
**Parent:** `docs/superpowers/specs/2026-05-08-pi-harness-design.md`
**Scope:** the first phase in the pi-harness pipeline (`brainstorm → plan → code → verify → pr`).

---

## Context

Today's pipeline (per the top-level design spec) auto-advances through every phase with no artifacts produced before code is written. That's fine for the mock harness but breaks the moment we point real agents at real tasks: the planner has no grounded input, the coder has no contract, and the user has no place to push back before implementation starts.

This phase replaces "agent reads task title and starts coding" with a deliberate kickoff: a structured interview that produces **two artifacts** (a design doc and a spec) plus a **single approval gate**, all anchored to a per-task worktree that the rest of the pipeline inherits.

The design borrows heavily from `juicesharp/rpiv-mono`'s `discover` / `design` skills (one-question-at-a-time interview, evidence-grounded recommendations, frontmatter lineage), but adapts them to our orchestrator-driven, multi-task, worktree-isolated model. rpiv runs in-place in a single human-driven REPL; we run many tasks in parallel under an orchestrator with persistent run state.

## Goals

1. Produce two task-scoped artifacts before plan phase starts: `design.md` and `spec.md`.
2. Create the task's worktree and branch at brainstorm entry so every subsequent phase operates on the same isolated tree.
3. Drive the user interaction through structured Q&A (not free-form chat) so the dashboard surfaces concrete decisions, not transcripts.
4. Gate phase advancement on explicit user approval of the bundle — no silent auto-advance out of brainstorm.
5. Preserve revision history: "Request changes" resumes the same run, amends artifacts, and appends to the chat log.

## Non-goals

- Producing a PRD. Task-level work has no exec audience; the "why" collapses into the design doc's context header.
- Multi-turn freeform chat sessions. Every turn is either a structured question with options or a user-initiated free-text override.
- Cross-task brainstorming. Each task gets its own brainstorm; no shared design surface.
- Automated artifact promotion across tasks (e.g., reusing one task's design as another's input).

## Alternatives considered

**A. Single combined doc (`brainstorm.md`).**
Cheaper to write, but conflates "is this the right approach" with "is the implementation correct" — exactly the conflation the research flagged as a top failure mode. Rejected.

**B. Three docs (PRD + design + spec).**
Matches classic enterprise practice but forces the agent to invent a fake PM voice for the PRD. Most of the PRD content (problem, users, success criteria) is already implied by the task title and a one-paragraph context block. Rejected as overengineered for task-level work.

**C. Free-form chat instead of structured Q&A.**
Lower friction for the user but produces unstructured transcripts the dashboard can't summarize, and lets the agent drift across topics. rpiv's experience with structured `ask_user_question` checkpoints is that it converges faster and produces auditable decisions. Rejected.

**D. Worktree created at plan phase, not brainstorm.**
Avoids creating a worktree for tasks that get rejected at the gate. But it means brainstorm artifacts have nowhere to live (they're per-task, not per-repo) and we lose branch lineage on the design itself. The cleanup cost of an abandoned worktree is small (`git worktree remove` is fast); the conceptual cost of artifacts floating outside any branch is large. Rejected.

**Chosen:** two artifacts (design + spec), worktree at brainstorm entry, structured Q&A, single bundle approval gate.

## Approach

### Artifact layout

```
.harness/T-NNN/
├── design.md            # context, goals/non-goals, alternatives, decisions
├── spec.md              # EARS acceptance criteria, edge cases, verify scenarios
└── brainstorm.jsonl     # append-only chat log (one event per line)
```

These paths live **inside the task's worktree** at `.harness/runs/r_NNN/.harness/T-NNN/...` and are committed on the task branch (`pi/T-NNN`). The main repo never carries per-task artifacts; everything is branch-scoped.

### Frontmatter contract

Both `design.md` and `spec.md` carry YAML frontmatter:

```yaml
---
task: T-NNN
kind: design | spec
parent: <path-to-prior-artifact>   # null for design; design.md for spec
status: draft | ready | approved
commit: <sha-at-write-time>
branch: pi/T-NNN
last_updated: 2026-05-09T14:30:00Z
last_updated_by: brainstorm-agent
---
```

`status` transitions: `draft` while the agent is still asking questions → `ready` when both artifacts are complete and self-critique passes → `approved` when the user clicks Approve on the dashboard. The orchestrator phase chain only advances out of brainstorm on `approved`.

### Document templates

**`design.md`** sections:
1. **Context** (1–2 paragraphs replacing PRD).
2. **Goals** (3–5 bullets).
3. **Non-goals** (explicit out-of-scope).
4. **Alternatives considered** (≥2, each with reject reason).
5. **Approach** (chosen design with file:line citations where the agent surveyed existing code).
6. **Trade-offs** (what we're giving up).
7. **Open questions** (deferred to plan phase).
8. **Decisions** — load-bearing handoff block; verbatim what plan phase reads as "already decided, do not re-litigate."

**`spec.md`** sections:
1. **Scope** (one paragraph).
2. **Acceptance criteria** in EARS format:
   - *Ubiquitous:* "The <system> shall <response>."
   - *Event-driven:* "When <trigger>, the <system> shall <response>."
   - *State-driven:* "While <state>, the <system> shall <response>."
   - *Optional-feature:* "Where <feature>, the <system> shall <response>."
   - *Unwanted-behavior:* "If <trigger>, then the <system> shall <response>."
3. **Edge cases** (one bullet per non-happy-path).
4. **Verification scenarios** (concrete test scenarios verify phase will run).
5. **Out of scope** (mirrors design.md non-goals at the testable level).

### Worktree lifecycle

On task entering brainstorm phase:
1. Orchestrator calls `WorktreeManager.create(taskId, runId)`.
2. Branch `pi/T-NNN` cut from main; worktree materialized at `.harness/runs/r_NNN/`.
3. Brainstorm subagent boots inside the worktree with `cwd` set there.
4. First commit on the branch is `chore(T-NNN): brainstorm scaffolding` — empty `design.md`/`spec.md` with frontmatter `status: draft`.

On "Request changes":
- Same run, same branch, same worktree.
- Agent appends a system event to `brainstorm.jsonl` (`{"type":"revision_requested","comment":"..."}`), resumes the Q&A loop, amends the artifacts in place, and rewrites `last_updated` + bumps the commit.

On full task retry (a separate, future flow — not part of this design):
- New run `r_NNN+1`, new branch `pi/T-NNN-r2`, fresh worktree. Old run is preserved for diffing.

### Interaction model

The brainstorm subagent runs a five-step loop, mirroring rpiv's `discover` skill:

1. **Foundational intent question.** Open-ended, no recommendation, no `file:line` citations. ("What is this task ultimately trying to enable?") Establishes scope before any code reading.
2. **Lightweight repo probe.** Bounded by the stated intent — read top-level structure, the most-likely-affected files, and any prior task's design doc referenced by the user.
3. **Decision-tree interview.** One question per turn, each carrying:
   - 2–4 structured options.
   - Exactly one tagged `(Recommended)`.
   - `file:line` evidence supporting the recommendation.
   - A free-text fallback (user can override any option with prose).
4. **Holistic self-critique.** Before marking artifacts ready, agent re-reads both docs and the JSONL log, checks for contradictions, fills gaps, and only then transitions `status: draft → ready`.
5. **Approval gate.** Dashboard surfaces both artifacts side-by-side with **Approve** and **Request changes** buttons. Approve → `status: approved`, phase chain advances. Request changes → user comment appended, agent resumes from step 3.

### Chat log format

`brainstorm.jsonl` is append-only, one JSON object per line. Event types:

```jsonc
{"type":"question","ts":"...","id":"q_001","prompt":"...","options":[{"id":"o1","label":"...","recommended":true,"evidence":["src/foo.ts:42"]}, ...]}
{"type":"answer","ts":"...","question_id":"q_001","option_id":"o2"}
{"type":"answer","ts":"...","question_id":"q_001","free_text":"..."}
{"type":"system","ts":"...","kind":"probe_complete|self_critique_passed|status_changed","data":{...}}
{"type":"revision_requested","ts":"...","comment":"..."}
```

The dashboard SSE stream tails new lines and renders them as chat bubbles. The orchestrator does not parse the log for control flow — it relies on artifact `status` for state transitions.

### Approval gate mechanics

- The brainstorm subagent's terminal state is `status: ready` on both artifacts. The agent then exits.
- The orchestrator marks the phase as `awaiting_approval` (a sub-state of brainstorm; not a new phase enum).
- Dashboard kanban card shows `review` status icon (the half-pie SVG already in the icon set) and exposes Approve / Request changes.
- **Approve** → server action sets `status: approved` on both artifacts, commits the change, advances task to plan phase.
- **Request changes** → server action takes a required comment, appends to `brainstorm.jsonl`, sets task back to `awaiting_user_input`, re-spawns the brainstorm subagent in the same worktree.

The `awaiting_approval` sub-state is the only deviation from "phase chain auto-advances" in the current design spec. It is intentional and scoped to brainstorm.

## Trade-offs

- **Worktree-at-entry has a small cost when tasks are abandoned at the gate.** Acceptable: `git worktree remove` is cheap, and abandonment should be rare.
- **JSONL chat log is not directly queryable.** We trade SQL queryability for branch-scoped retention and natural retry isolation. If we ever need cross-task analytics on brainstorm sessions, we can index the JSONL into Postgres later — the events are already structured.
- **Structured Q&A is more constraining than free-form chat.** Users can override with free text on any question, but the default flow is opinionated. Bet: convergence and auditability matter more than expressive freedom for this phase.
- **Two artifacts means two things to review.** We picked single-bundle approval to keep the click count low; the trade-off is the user can't approve design while sending spec back. If that becomes a real friction we'll revisit per-artifact approval.
- **`awaiting_approval` is a phase sub-state, not a phase.** Keeps the `TASK_STATUSES` enum stable but adds one place where the kanban card status diverges from the raw phase enum. Documented; tolerable.

## Open questions

(Deferred to plan phase, not blockers for this design.)

- Exact prompt template for the brainstorm subagent — whether to vendor rpiv's `discover` SKILL.md or write our own.
- How the dashboard renders option-with-evidence questions (likely a new component; needs frontend-design skill pass).
- Whether the approval action commits a marker file (`.harness/T-NNN/APPROVED`) or only mutates frontmatter — the latter is cleaner if we trust git history.
- Janitor behavior: when a task is abandoned at the gate, do we keep the branch for audit or prune?

## Decisions

The following are settled and inputs to plan phase. Plan must not re-litigate.

1. Brainstorm produces exactly two artifacts: `design.md` and `spec.md`. No PRD.
2. Both artifacts live in the task's worktree at `.harness/T-NNN/` and are committed on branch `pi/T-NNN`.
3. Worktree and branch are created at brainstorm entry, before the agent runs.
4. Spec uses EARS format for acceptance criteria.
5. Interaction is structured Q&A with `(Recommended)` options + `file:line` evidence; free-text override allowed per question.
6. Chat log is `brainstorm.jsonl` in the worktree, append-only, streamed to the dashboard via SSE.
7. Approval is a single bundle gate with two outcomes: **Approve** (advances to plan) and **Request changes** (resumes same run, same worktree, same branch).
8. `awaiting_approval` is modeled as a sub-state of the brainstorm phase, not a new phase enum.
9. Frontmatter status lifecycle: `draft → ready → approved`. Phase chain only advances on `approved`.
10. Revisions stay on the same run/branch; new runs are reserved for full task retries (separate future flow).
