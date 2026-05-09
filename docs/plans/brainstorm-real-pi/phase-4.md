# Phase 4: Brainstorm agent rewrite + disk-resume

> **Status:** pending

## Overview

After this phase the brainstorm phase no longer walks `BRAINSTORM_SCRIPT`. Each tick opens (or resumes) a real pi session in the worktree, decides what prompt to feed it based on JSONL state, drains events, and returns. The dashboard sees the same `brainstorm_question` / `brainstorm_answer` / `brainstorm_system` events it sees today — only the producer changes. The script + its tests are deleted.

This is the largest phase. Depends on Phase 1 (config), Phase 2 (bridge), Phase 3 (tools).

## Implementation

**Files:**
- Rewrite: `apps/orchestrator/src/agents/brainstorm.ts`
- Delete: `apps/orchestrator/src/agents/brainstorm-script.ts` and any tests of it.
- Modify: `apps/orchestrator/src/runner/run-loop.ts` — pass merged `phaseModel` config to the brainstorm tick; record `piSessionPath` on first creation.
- Modify: `apps/orchestrator/src/runner/phase-prompts.ts` — `runPhase("brainstorm", ...)` accepts `{ phaseModel, sessionPath }`; threads them in.
- Modify: `packages/shared/src/types/run.ts` — add `piSessionPath: string | null` to `Run`.
- Modify: `packages/db/drizzle/<next>_pi_session_path.sql` + `schema.ts` — additive column, default `null`.
- Modify: `apps/orchestrator/src/adapters/run-store.ts` — round-trip the new field.
- Test: `apps/orchestrator/src/agents/brainstorm.test.ts` — rewritten against `FakeAgentSdkAdapter` (from Phase 2).

**Pattern to follow:** existing `brainstorm.ts` for the tick contract + JSONL-cursor reasoning; `apps/orchestrator/src/agents/code.ts` for the bridge-session lifecycle (`createSession`, `try/finally`, `close`).

**What to build:**

The new `runBrainstorm(opts)`:

```ts
export type BrainstormOpts = {
  taskId: string;
  cwd: string;
  store: ArtifactsStore;
  bus: BrainstormEventBus;
  phaseModel: PhaseModelConfig;
  sessionPath: string;                      // <cwd>/.harness/<taskId>/pi-session.jsonl
  createAgentSession: (opts: AgentSessionOptions) => Promise<AgentSession>;
};
```

Tick algorithm (mirrors the spec's "Resume strategy" section):

```
1. Read brainstorm.jsonl into events.
2. If a status_changed→ready event is present → return { ok: true, ready: true, ...zeros }.
3. Compute decision:
     a. Initial      — no events at all.
     b. AnswersDelta — answers exist that postdate the last agent activity (last `brainstorm_question` or `brainstorm_system` from the bridge).
     c. Revision     — a brainstorm_revision_requested event postdates the last agent activity.
     d. NoOp         — none of the above (re-entry without progress) → return { ok: true, ready: false, ...zeros }.
4. Build prompt text per decision (helpers below).
5. Open session: createAgentSession({
      cwd, model: phaseModel,
      thinkingLevel: phaseModel.thinkingLevel,
      maxTurns: phaseModel.maxTurns,
      systemPrompt: readFileSync(BRAINSTORM_PROMPT_PATH),
      sessionPath,                              // resume if exists, fresh otherwise
      customTools: [submitQuestionsTool, markReadyTool],
      onEvent: (e) => observe(e, ctx),
   }).
   Built-in tools dropped to read+write only by passing customTools and a filtered builtin list — exact mechanism: pass `customTools: [...createCodingTools(cwd).filter(t => ["read","write"].includes(t.name)), submitQuestionsTool, markReadyTool]`. The bridge does not auto-add coding tools when `customTools` is set (define this in Phase 2; if it does, drop bash/edit before passing).
6. const usage = await session.prompt(promptText).
7. await session.close().
8. Inspect ctx for haltReason: "questions" | "ready" | "exhausted" (turn ended naturally without termination — likely the agent didn't call a custom tool; treat as ok-but-unresolved, return ready: false, log a warning).
9. Inspect store: read both artifacts; if both fm.status === "ready" → ready=true (mark_ready already wrote them and published status_changed).
10. Return { ok, ready, costUsd: usage.costUsd, inputTokens, outputTokens, error? }.
```

`observe(e, ctx)`:
- `tool_call("submit_questions", ...)` → ctx.haltReason = "questions" (the tool handler does the bus.publish; we just track the halt cause).
- `tool_call("mark_ready", ...)` → after `tool_result` arrives with `details.ok === true`, ctx.haltReason = "ready".
- `tool_result("write", ...)` where `path` ends with `/.harness/<taskId>/design.md` or `.../spec.md` → republish through `store.readArtifact` to fire the dashboard's diff-update event chain (call out: confirm `ArtifactsStore` already has the right hook; if not, do a no-op read here and let the next phase pick it up).
- All other events: forward to a debug logger only.

**Prompt builders:**

```ts
function initialPrompt(taskTitle, taskDescription, taskId, cwd) { /* see spec */ }
function answersDeltaPrompt(newAnswers) { return `User answered:\n${newAnswers.map(a => `- ${a.questionId}: ${describe(a)}`).join("\n")}\n\nContinue.`; }
function revisionPrompt(comment) { return `User requested revisions: ${comment}\n\nRe-examine the artifacts and ask any clarifying questions you need.`; }
```

**Run-loop changes (`run-loop.ts`):**
- Compute `phaseModel = mergePhaseModels(task.phaseModels, "brainstorm")`.
- Compute `sessionPath = join(worktree.path, ".harness", task.id, "pi-session.jsonl")`.
- Persist `sessionPath` on the run row (`runs.updateRun(run.id, { piSessionPath: sessionPath })` on first dispatch).
- Pass through to `runPhase`.

**Failure handling (mirror the spec's table):**
- `AuthError` from bridge: emit `phase_blocked` event, return `{ ok: false, error: "missing API key for <provider>" }`.
- `maxTurns exceeded`: return `{ ok: false, error: "brainstorm: maxTurns exceeded" }`. Run-loop maps this to a state-machine `agent_phase_failed`.
- pi-session.jsonl corrupted (`SessionManager.open` throws): catch in the tick, log, delete the file, retry once with no `sessionPath` — the bridge will re-init in-memory and the bus replay (next answer's prompt) carries the conversation forward.

**What to test:**
- Initial tick: empty JSONL → bridge `prompt(...)` called with the initial prompt; observed `tool_call("submit_questions", ...)` halts; tool handler publishes 3 `brainstorm_question` events; tick returns `{ ok: true, ready: false }`.
- Answers delta: append `brainstorm_answer` events to JSONL → next tick prompts with "User answered: ...". Verify the prompt text contains all new answers.
- Revision: append `brainstorm_revision_requested` → next tick prompts with the revision comment.
- NoOp: tick called with no new events since last agent activity → returns immediately, no bridge call.
- Ready path: bridge emits `tool_call("mark_ready")` → handler writes artifacts → store sees `status: ready` → tick returns `{ ok: true, ready: true }`.
- Resume: first tick with no `pi-session.jsonl` → bridge called with `sessionPath` set; second tick (after restart simulation) → bridge called with same `sessionPath` and the SDK adapter records that `SessionManager.open` was used.
- maxTurns exceeded → tick returns `{ ok: false, error: "brainstorm: maxTurns exceeded" }`.
- AuthError → tick returns `{ ok: false, error: "missing API key for anthropic" }` AND a `phase_blocked` event was appended.
- Corrupted pi-session.jsonl → tick deletes the file, retries, succeeds; assert log entry.
- Existing `runBrainstorm` integration test that drives a full cycle with `FakeAgentSdkAdapter` standing in for the script.

**Commit:** `feat(orchestrator): replace brainstorm script with real pi agent session`

## Done When

- [ ] `apps/orchestrator/src/agents/brainstorm-script.ts` deleted; no references remain in the workspace.
- [ ] `pnpm --filter @pi-harness/orchestrator test` passes.
- [ ] Dashboard tests pass (no contract change — we feed the same events).
- [ ] An orchestrator restart mid-Q&A resumes correctly (covered by the resume integration test).
- [ ] `task.phaseModels` is read on every brainstorm tick.

## E2E Verification

Yes — this phase makes the dashboard's brainstorm flow real. After the unit/integration tests pass:

- **Infrastructure needed:** `pnpm db:up`, orchestrator running, dashboard running, fake-SDK env (no real API calls in CI). The live Anthropic exercise is Phase 6.
- **Browser verification:** create a task → confirm worktree, design.md and spec.md scaffolding, brainstorm phase enters → fake adapter (toggled via env) drives a scripted question batch → dashboard renders QuestionCards → answer → next batch → mark ready → approval gate appears.

This proves the dashboard contract is intact even though the producer changed.
