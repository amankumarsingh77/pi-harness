# Pages And User Stories

Date: 2026-05-19

This document defines the proposed UI for the redesigned pi-harness workflow.
All wireframes are ASCII so the information architecture stays obvious before
visual design begins.

## Page Map

```text
+-----------------------+------------------------------------------------+
| Page                  | Purpose                                        |
+-----------------------+------------------------------------------------+
| Mission Board         | See all tasks and runtime health               |
| New Mission           | Turn rough user intent into a mission packet   |
| Mission Command       | Main live task screen                          |
| Context Preflight     | Inspect scout findings and context quality     |
| Strategy Gate         | Approve graph, risk, ownership, and policy     |
| Execution Runtime     | Watch active workcells and agent collaboration |
| Workcell Detail       | Debug one builder/verifier pair                |
| Proof Gate            | Decide whether the result is trustworthy       |
| Replay                | Audit the full event ledger after the fact     |
| Policy Settings       | Configure path, command, and approval rules    |
+-----------------------+------------------------------------------------+
```

The pages do not need to be implemented as separate routes in every case. Some
can be tabs inside Mission Command. The product concept is page-level because
each surface answers a different user question.

## 1. Mission Board

### User Story

As a user, I want to see every active mission, its risk, progress, blocked
points, and shippability without opening each task, so I can decide where my
attention is needed.

### Function

The Mission Board replaces a pure phase Kanban with a board organized around
mission health. It still supports workflow/status filtering, but the primary
signal is "what needs attention?"

### ASCII

```text
+--------------------------------------------------------------------------------+
| pi-harness                                                   [New Mission] [/] |
+--------------------------------------------------------------------------------+
| Filters: [All] [Needs input] [Running] [Blocked] [Ready] [Failed]              |
| Search:  [ retry billing flow___________________________________________ ]      |
+--------------------------------------------------------------------------------+
| HEALTH SUMMARY                                                                  |
| Active 8   Need input 2   Blocked 1   Ready 3   Cost today $12.84              |
+--------------------------------------------------------------------------------+
|                                                                                |
| +----------------------+ +----------------------+ +----------------------+     |
| | NEEDS INPUT          | | RUNNING              | | READY TO SHIP        |     |
| |----------------------| |----------------------| |----------------------|     |
| | T-104 Billing retry  | | T-109 Plan console   | | T-098 Docs polish    |     |
| | Risk medium          | | 4 agents active      | | Proof 7/7            |     |
| | Gate: strategy       | | Claims 3/8 proven    | | Diff +214 -32        |     |
| | Waiting 12m          | | Cost $1.42           | | [Open] [Ship]        |     |
| | [Review Gate]        | | [Open]               | |                      |     |
| |----------------------| |----------------------| |----------------------|     |
| | T-105 Auth cleanup   | | T-111 SSE repair     | | T-101 UI snapshot    |     |
| | Risk high            | | verifier challenging | | Proof 5/5            |     |
| | Policy approval      | | Blocked claims 1     | | [Open] [Ship]        |     |
| | [Approve?]           | | [Open]               | |                      |     |
| +----------------------+ +----------------------+ +----------------------+     |
|                                                                                |
| +----------------------+ +----------------------+                              |
| | BLOCKED              | | FAILED               |                              |
| |----------------------| |----------------------|                              |
| | T-107 DB migration   | | T-095 Import bug     |                              |
| | blocked: migration   | | failed: tests        |                              |
| | [Inspect Policy]     | | [Open Repair]        |                              |
| +----------------------+ +----------------------+                              |
|                                                                                |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Click a mission card to open Mission Command.
- Click `Review Gate` to jump directly to Strategy Gate.
- Click `Ship` to open Proof Gate.
- Click `Inspect Policy` to open the policy event that blocked progress.

### Useful Live Output

Cards update when:

- an agent starts or ends
- a claim changes state
- a policy event blocks work
- proof results arrive
- cost or token totals change

## 2. New Mission

### User Story

As a user, I want to paste a rough request and let the harness turn it into a
bounded mission, so I do not have to choose the perfect workflow manually.

### Function

New Mission is not a chat page. It is a mission compiler. It captures intent,
classifies the work, estimates risk, and proposes a workflow.

### ASCII

```text
+--------------------------------------------------------------------------------+
| New Mission                                                           [Cancel] |
+--------------------------------------------------------------------------------+
| REQUEST                                                                        |
| +----------------------------------------------------------------------------+ |
| | Completely redesign the workflow based on Disler learnings...              | |
| |                                                                            | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| Attach context: [GitHub issue] [Linear] [Paste plan] [Select files]            |
+--------------------------------------------------------------------------------+
| MISSION COMPILER                                                               |
|                                                                                |
| +----------------------------+ +----------------------------+                  |
| | Classification             | | Risk Estimate              |                  |
| |----------------------------| |----------------------------|                  |
| | Type: product redesign     | | Risk: medium               |                  |
| | Workflow: design-only      | | Blast radius: docs/ui      |                  |
| | Needs code: no             | | Human gates: strategy      |                  |
| +----------------------------+ +----------------------------+                  |
|                                                                                |
| +----------------------------------------------------------------------------+ |
| | Proposed Mission Packet                                                     | |
| |----------------------------------------------------------------------------| |
| | Goal: document redesigned mission-control workflow                          | |
| | Success: ASCII pages + user stories under docs/redesign                     | |
| | Constraints: no code changes, do not touch active dashboard work            | |
| | Verification: docs exist, links work, page map complete                     | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| [Edit Mission Packet]                                [Create Mission ->]       |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- User enters raw intent.
- Harness generates a mission packet.
- User edits the packet only if needed.
- Create Mission starts Context Preflight.

### Useful Live Output

This page should show compiler confidence:

```text
Workflow confidence: 87%
Missing context: none
Suggested next step: preflight scouts
```

## 3. Mission Command

### User Story

As a user, I want one live screen that tells me what the harness is doing, what
needs my input, what proof exists, and whether the mission is healthy.

### Function

Mission Command is the central page. It replaces the idea that every phase needs
a separate mental model. Tabs or panels expose details, but the summary stays
stable throughout the mission.

### ASCII

```text
+--------------------------------------------------------------------------------+
| T-104 Billing retry flow                         Risk Medium   Cost $1.42      |
| Branch pi/T-104                                  Live 8s ago   [Cancel] [...]  |
+----------------------+-------------------------------+-------------------------+
| MISSION              | AGENT RUNTIME                 | PROOF                   |
|----------------------|-------------------------------|-------------------------|
| Goal                 | Mission lead      running     | Typecheck      pending  |
| Add retry flow       | codebase-scout    done        | Unit tests     running  |
|                      | test-scout        done        | UI scenario    queued   |
| Acceptance           | api-builder       running     | Verifier       3/8      |
| [x] retry persists   | api-verifier      challenging | Diff review    pending  |
| [ ] no duplicates    | ui-builder        queued      | Policy issues  none     |
| [ ] UI recovers      |                               |                         |
|                      | Claims                        | Evidence                |
| Risk Notes           | + retry persisted   proven    | retry.test.ts           |
| - billing path       | + no duplicate      challenged| api response pending    |
| - idempotency        | + UI recovers       pending   | screenshot pending      |
|                      |                               |                         |
| File Ownership       | Live Transcript               | Ship Readiness          |
| api-builder          | ----------------------------- | Not ready               |
| apps/api/billing/*   | builder: updated retry code   | 3 claims unresolved     |
| ui-builder           | verifier: prove idempotency   |                         |
| apps/dashboard/*     | policy: allowed pnpm test     | [Open Proof Gate]       |
+----------------------+-------------------------------+-------------------------+
| Tabs: [Overview] [Preflight] [Strategy] [Runtime] [Proof] [Replay]             |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Click an agent to open Workcell Detail.
- Click a claim to see its proof thread.
- Click a transcript line to open the replay position.
- Click Proof Gate when the system says the task is close to shippable.

### Useful Live Output

The page should distinguish:

```text
agent state       what is running
claim state       what is true or unproven
policy state      what was blocked or approved
proof state       what evidence exists
```

Raw logs should be available, but not primary.

## 4. Context Preflight

### User Story

As a user, I want to see what the scouts learned before expensive coding starts,
so I can catch missing context early.

### Function

Context Preflight shows read-only scout work. It answers: "Does the harness
understand the codebase enough to proceed?"

### ASCII

```text
+--------------------------------------------------------------------------------+
| T-104 / Context Preflight                                           Live       |
+--------------------------------------------------------------------------------+
| SCOUTS                                                                         |
| +-------------------+ +-------------------+ +-------------------+              |
| | codebase-scout    | | test-scout        | | risk-scout        |              |
| |-------------------| |-------------------| |-------------------|              |
| | done 42s          | | done 31s          | | done 26s          |              |
| | Confidence high   | | Confidence medium | | Confidence medium |              |
| | Files 12          | | Tests 8           | | Risks 4           |              |
| +-------------------+ +-------------------+ +-------------------+              |
|                                                                                |
| CONTEXT PACK                                                                   |
| +-------------------------------+--------------------------------------------+ |
| | Relevant Files                | Findings                                   | |
| |-------------------------------|--------------------------------------------| |
| | apps/orchestrator/...         | retry logic currently lives in runner      | |
| | packages/shared/...           | no existing idempotency test found         | |
| | apps/dashboard/...            | UI has failed-run card pattern             | |
| +-------------------------------+--------------------------------------------+ |
|                                                                                |
| GAPS                                                                           |
| +----------------------------------------------------------------------------+ |
| | [medium] No fixture found for duplicate billing event                       | |
| | [low] UI scenario likely needs Playwright auth setup                        | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| [Ask More Scouts]                              [Proceed To Strategy ->]        |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Expand a scout to read full findings.
- Ask more scouts for a missing angle.
- Proceed only when context is sufficient.

### Useful Live Output

Scout cards should update independently as agents complete.

## 5. Strategy Gate

### User Story

As a user, I want to approve the actual execution graph, file ownership, risk,
and policy before code starts, so I can prevent expensive wrong work.

### Function

Strategy Gate is the main human judgment checkpoint. It replaces overlong
planning docs with a concise operational plan.

### ASCII

```text
+--------------------------------------------------------------------------------+
| T-104 / Strategy Gate                                               Awaiting   |
+--------------------------------------------------------------------------------+
| EXECUTION GRAPH                                                                 |
|                                                                                |
| codebase-scout                                                                 |
|      |                                                                         |
|      v                                                                         |
| test-scout ---> api-builder ---> api-verifier                                  |
|                    |                                                           |
|                    v                                                           |
|               ui-builder ---> ui-verifier                                      |
|                    |                                                           |
|                    v                                                           |
|             integration-lead                                                   |
|                                                                                |
+--------------------------------------------------------------------------------+
| OWNERSHIP                         | CLAIMS TO PROVE                             |
|-----------------------------------|---------------------------------------------|
| api-builder                       | retry state survives restart                |
| apps/orchestrator/src/runner/*    | duplicate charge cannot be emitted          |
|                                   | failing retry has visible UI state          |
| ui-builder                        | no unrelated task statuses regress          |
| apps/dashboard/components/*       |                                             |
+--------------------------------------------------------------------------------+
| POLICY PROFILE                                                                  |
| +----------------------------------------------------------------------------+ |
| | Risk: medium                                                               | |
| | Allowed: read, edit scoped files, pnpm test, pnpm typecheck                | |
| | Approval required: migrations, package installs, env edits                 | |
| | Blocked: .env, node_modules, unrelated apps                               | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| [Request Changes]                                      [Approve Execution ->]  |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Edit file ownership before execution.
- Add or remove claims.
- Tighten or loosen policy.
- Approve execution.

### Useful Live Output

This page should be mostly stable. If scouts are still running, it should show
which graph nodes are blocked on missing context.

## 6. Execution Runtime

### User Story

As a user, I want to watch the live agent runtime at the level of workcells,
claims, and policy events, so I know whether the harness is making real progress.

### Function

Execution Runtime is the live build page. It is not a wall of logs. It is a
structured operational view.

### ASCII

```text
+--------------------------------------------------------------------------------+
| T-104 / Execution Runtime                         4 active agents   $2.18      |
+--------------------------------------------------------------------------------+
| WORKCELLS                                                                      |
| +--------------------------+ +--------------------------+ +-------------------+ |
| | api-builder              | | api-verifier             | | ui-builder        | |
| |--------------------------| |--------------------------| |-------------------| |
| | running                  | | challenging              | | queued            | |
| | files 5/5 in scope       | | claims 1 challenged      | | waits on API      | |
| | last edit 9s ago         | | feedback sent 14s ago    | |                   | |
| | [Open]                   | | [Open]                   | | [Open]            | |
| +--------------------------+ +--------------------------+ +-------------------+ |
|                                                                                |
| CLAIM LEDGER                                                                   |
| +------------------------------+------------+-------------+------------------+ |
| | Claim                        | Owner      | Status      | Proof            | |
| |------------------------------|------------|-------------|------------------| |
| | retry state persists         | api        | proven      | retry.test.ts    | |
| | duplicate charge impossible  | verifier   | challenged  | needs test       | |
| | UI shows retry failure       | ui         | pending     | waiting          | |
| +------------------------------+------------+-------------+------------------+ |
|                                                                                |
| POLICY FEED                         LIVE TRANSCRIPT                            |
| +----------------------------------+ +----------------------------------------+ |
| | allowed pnpm test api            | | api-builder: patching runner           | |
| | blocked edit .env                | | verifier: idempotency not proven       | |
| | requested migration approval     | | api-builder: adding regression test    | |
| +----------------------------------+ +----------------------------------------+ |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Open a workcell.
- Filter transcript by agent, tool call, policy, verifier feedback, or error.
- Approve or deny policy requests.
- Pause or cancel a specific workcell.

### Useful Live Output

The page should show motion without requiring reading:

```text
agent state changes
claim status changes
last edit age
last proof age
blocked policy events
test progress
```

## 7. Workcell Detail

### User Story

As a user, I want to inspect one workcell deeply when something looks suspicious,
so I can debug or steer without losing the global mission view.

### Function

Workcell Detail is the microscope. It shows builder output, verifier challenges,
file scope, tool calls, and local proof.

### ASCII

```text
+--------------------------------------------------------------------------------+
| Workcell: api-builder                                             [Back]       |
+--------------------------------------------------------------------------------+
| MISSION SLICE                         | STATUS                                  |
|---------------------------------------|-----------------------------------------|
| Add retry persistence in runner       | running                                 |
|                                       | Last edit: 9s ago                       |
| File scope                            | Cost: $0.68                             |
| apps/orchestrator/src/runner/*        | Policy: medium                          |
| packages/shared/src/types/task.ts     |                                         |
+--------------------------------------------------------------------------------+
| BUILDER / VERIFIER THREAD                                                       |
| +----------------------------------------------------------------------------+ |
| | builder: I changed the retry state transition.                              | |
| | verifier: Show proof that duplicate charges cannot happen.                  | |
| | builder: Adding idempotency regression test now.                            | |
| | verifier: Also check failed retry state is visible to dashboard.            | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| LOCAL CLAIMS                                                                    |
| +------------------------------+-------------+-------------------------------+ |
| | Claim                        | Status      | Evidence                      | |
| |------------------------------|-------------|-------------------------------| |
| | retry state persists         | proven      | runner.retry.test.ts          | |
| | duplicate charge impossible  | challenged  | missing assertion             | |
| | dashboard status unchanged   | pending     | not run                       | |
| +------------------------------+-------------+-------------------------------+ |
|                                                                                |
| TOOL CALLS                          LOCAL DIFF                                 |
| +--------------------------------+  +-----------------------------------------+ |
| | read runner.ts                 |  | + retryAttemptId                       | |
| | edit runner.ts                 |  | + idempotency guard                    | |
| | pnpm test runner.retry.test.ts |  | - old retry branch                     | |
| +--------------------------------+  +-----------------------------------------+ |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Send a steering note to builder or verifier.
- Retry the workcell.
- Expand local diff.
- Promote local proof to mission proof.

### Useful Live Output

This page should preserve a conversation-like thread, but only within one
workcell. The main runtime page should remain structured.

## 8. Proof Gate

### User Story

As a user, I want the harness to answer "Can I trust this?" with evidence, not
optimism, before I commit or open a PR.

### Function

Proof Gate is the final decision surface. It summarizes all automated checks,
claims, screenshots, diffs, and unresolved risks.

### ASCII

```text
+--------------------------------------------------------------------------------+
| T-104 / Proof Gate                                      Ship readiness: 86%    |
+--------------------------------------------------------------------------------+
| FINAL CHECKS                                                                    |
| +-------------------+-------------+----------------------+--------------------+ |
| | Check             | Status      | Evidence             | Notes              | |
| |-------------------|-------------|----------------------+--------------------| |
| | Typecheck         | pass        | typecheck.log        |                    | |
| | Unit tests        | pass        | vitest.log           | 42 tests           | |
| | UI scenario       | pass        | retry-flow.png       | Playwright         | |
| | Verifier claims   | 7/8 proven  | claim-ledger.json    | 1 accepted risk    | |
| | Diff review       | pass        | diff-summary.md      | scoped             | |
| +-------------------+-------------+----------------------+--------------------+ |
|                                                                                |
| UNRESOLVED                                                                      |
| +----------------------------------------------------------------------------+ |
| | [low] No load test for 1000 concurrent retry events                         | |
| | Decision: acceptable for current scope                                      | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| SHIP PACKAGE                                                                    |
| +----------------------------------------------------------------------------+ |
| | Branch: pi/T-104                                                            | |
| | Files changed: 9                                                            | |
| | Commits: 3                                                                  | |
| | PR title: fix(orchestrator): persist retry state                            | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| [Open Replay]           [Request Repair]           [Create PR / Mark Ready]    |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Open any proof artifact.
- Accept a low-risk unresolved item.
- Request repair for a failed claim.
- Create PR or mark ready.

### Useful Live Output

Proof Gate should update as tests finish. It should never hide a failed check
behind a green overall status.

## 9. Replay

### User Story

As a user, I want to replay exactly what happened during a mission, so I can
debug failures, audit decisions, or learn from successful runs.

### Function

Replay is the event ledger viewer. It combines agent messages, tool calls,
policy events, claim transitions, artifacts, and proof results.

### ASCII

```text
+--------------------------------------------------------------------------------+
| T-104 / Replay                                      [All] [Agents] [Policy]    |
+--------------------------------------------------------------------------------+
| TIMELINE                                                                       |
|                                                                                |
| 10:42:01  mission.created             user request imported                    |
| 10:42:08  scout.started               codebase-scout                           |
| 10:42:32  scout.ended                 codebase-scout, confidence high          |
| 10:43:02  strategy.awaiting_user      graph ready                              |
| 10:45:19  strategy.approved           user approved execution                  |
| 10:45:21  workcell.started            api-builder                              |
| 10:45:41  tool.call                   edit runner.ts                           |
| 10:45:49  policy.blocked              attempted .env read                      |
| 10:46:02  claim.challenged            duplicate charge impossible              |
| 10:47:18  proof.pass                  runner.retry.test.ts                     |
| 10:49:05  ship.ready                  proof gate passed                        |
|                                                                                |
+--------------------------------------------------------------------------------+
| SELECTED EVENT                                                                  |
| +----------------------------------------------------------------------------+ |
| | policy.blocked                                                              | |
| | Agent: api-builder                                                          | |
| | Reason: .env is protected by medium-risk policy                             | |
| | Result: tool call blocked, corrective message sent to agent                 | |
| +----------------------------------------------------------------------------+ |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Filter timeline by event kind.
- Click an event to inspect payload.
- Jump from event to artifact, claim, workcell, or proof.
- Export replay bundle for debugging.

### Useful Live Output

Replay can be live while a mission is active, but its primary value is after the
fact. It should be complete and trustworthy.

## 10. Policy Settings

### User Story

As a user, I want to configure what agents may do by default, so the harness is
safe without asking me about every harmless action.

### Function

Policy Settings defines the default rules used by the policy kernel. Mission
Strategy Gate can override them per task.

### ASCII

```text
+--------------------------------------------------------------------------------+
| Policy Settings                                                                |
+--------------------------------------------------------------------------------+
| RISK PROFILES                                                                  |
| +----------------+----------------+----------------+----------------+          |
| | Low            | Medium         | High           | Locked         |          |
| |----------------|----------------|----------------|----------------|          |
| | edit scoped    | approve deps   | approve writes | read-only      |          |
| | run tests      | block env      | block package  | no shell       |          |
| +----------------+----------------+----------------+----------------+          |
|                                                                                |
| PROTECTED PATHS                                                                |
| +----------------------------------------------------------------------------+ |
| | .env*                                                                       | |
| | node_modules/**                                                             | |
| | pnpm-lock.yaml unless dependency-change approved                            | |
| | infra/** unless infra workflow                                              | |
| +----------------------------------------------------------------------------+ |
|                                                                                |
| COMMAND APPROVALS                                                              |
| +-------------------------------+----------------+---------------------------+ |
| | Command class                 | Default        | Applies to                | |
| |-------------------------------|----------------|---------------------------| |
| | package install               | ask            | all workflows             | |
| | migration                     | ask            | db workflows              | |
| | destructive git               | block          | all workflows             | |
| | test/typecheck                | allow          | all workflows             | |
| +-------------------------------+----------------+---------------------------+ |
|                                                                                |
| [Save Policy]                                                                  |
+--------------------------------------------------------------------------------+
```

### Key Interactions

- Add protected paths.
- Configure command classes.
- Define risk profiles.
- Preview which policy would apply to a sample mission.

## User Journey

This is the intended happy path.

```text
1. User creates a mission
   |
   v
2. Harness compiles mission packet
   |
   v
3. Scouts gather context in parallel
   |
   v
4. User approves strategy gate
   |
   v
5. Builder/verifier workcells run
   |
   v
6. Claims become proven or challenged
   |
   v
7. Integration lead assembles final diff
   |
   v
8. Proof gate runs final checks
   |
   v
9. User ships, repairs, or archives
```

## Failure Journey

```text
1. Workcell makes bad claim
   |
   v
2. Verifier challenges claim
   |
   v
3. Builder attempts risky shortcut
   |
   v
4. Policy kernel blocks action
   |
   v
5. Runtime surfaces blocked claim and policy event
   |
   v
6. User opens Workcell Detail
   |
   v
7. User steers or requests targeted repair
   |
   v
8. Repair loop reruns only affected workcell/proof
```

## Minimum Useful UI Slice

The full redesign is large. The smallest useful implementation slice is:

```text
Mission Command
  |
  +-- agent runtime panel
  +-- claim ledger
  +-- policy feed
  +-- proof summary
  +-- filtered transcript
```

That slice alone would make live output far more useful than the current
phase/log view.

