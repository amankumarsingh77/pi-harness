# Operating Model

Date: 2026-05-19

## Problem

The current harness is organized around a visible phase chain:

```text
brainstorm -> plan -> code -> verify -> pr
```

That is understandable, but it makes the system slower than it needs to be:

- verification arrives late
- brainstorm and plan can become over-large
- live output is hard to scan because logs are not the same as state
- safety depends too much on worktree isolation
- subagents act like helpers inside phases, not first-class runtime participants

The redesign keeps the useful discipline of phases, but wraps them in a runtime
that supervises agents continuously.

## New Principle

```text
Phases provide structure.
Runtime reflexes provide performance.
```

The harness should not merely ask "what phase are we in?" It should also answer:

- What is the mission?
- Which agents are active?
- What claims are being made?
- Which claims are proven?
- What has been blocked by policy?
- Which files are owned by which workcell?
- What evidence exists?
- Is this shippable right now?

## Runtime Architecture

```text
+--------------------------------------------------------------------------------+
|                                PI HARNESS                                       |
|                         Local Mission Control Runtime                           |
+--------------------------------------------------------------------------------+
                                      |
                                      v
+--------------------------------------------------------------------------------+
|                                Mission Runtime                                  |
|--------------------------------------------------------------------------------|
|                                                                                |
|  +----------------+       +----------------+       +----------------+          |
|  | Policy Kernel  |<----->| Agent Runtime  |<----->| Verifier Loop  |          |
|  |----------------|       |----------------|       |----------------|          |
|  | tool policy    |       | Pi sessions    |       | challenges     |          |
|  | path guards    |       | active agents  |       | claim checks   |          |
|  | approval rules |       | streaming      |       | feedback loops |          |
|  | risk profiles  |       | cancellation   |       | proof demands  |          |
|  +----------------+       +----------------+       +----------------+          |
|                                                                                |
|  +----------------+       +----------------+       +----------------+          |
|  | Context Kernel |<----->| Event Ledger   |<----->| Artifact Store |          |
|  |----------------|       |----------------|       |----------------|          |
|  | scout findings |       | JSONL + DB     |       | mission packet |          |
|  | repo memory    |       | replay stream  |       | plan/proof     |          |
|  | compact facts  |       | audit trail    |       | screenshots    |          |
|  | summaries      |       | live dashboard |       | diffs/logs     |          |
|  +----------------+       +----------------+       +----------------+          |
|                                                                                |
+--------------------------------------------------------------------------------+
```

## End-To-End Workflow

```text
+-------------------+
| Human Request     |
+---------+---------+
          |
          v
+---------+---------+
| 1. Intake         |
|-------------------|
| normalize request |
| classify work     |
| estimate risk     |
| choose workflow   |
+---------+---------+
          |
          v
+---------+---------+
| 2. Mission Packet |
|-------------------|
| goal              |
| acceptance        |
| constraints       |
| likely files      |
| claims to prove   |
| policy profile    |
+---------+---------+
          |
          v
+---------+--------------------------------------------------+
| 3. Context Preflight                                      |
|------------------------------------------------------------|
| codebase-scout | test-scout | risk-scout | precedent-scout |
+---------+--------------------------------------------------+
          |
          v
+---------+---------+
| 4. Strategy Gate  |
|-------------------|
| execution graph   |
| file ownership    |
| risk review       |
| human gate        |
+---------+---------+
          |
          v
+---------+--------------------------------------------------------------+
| 5. Execution Runtime                                                   |
|------------------------------------------------------------------------|
|                                                                        |
|  +--------------+    +--------------+    +--------------+              |
|  | Workcell A   |    | Workcell B   |    | Workcell C   |              |
|  |--------------|    |--------------|    |--------------|              |
|  | builder      |    | builder      |    | builder      |              |
|  | verifier     |    | verifier     |    | verifier     |              |
|  | file scope   |    | file scope   |    | file scope   |              |
|  +------+-------+    +------+-------+    +------+-------+              |
|         |                   |                   |                      |
|         +-------------------+-------------------+                      |
|                             |                                          |
|                             v                                          |
|                     +-------+--------+                                 |
|                     | Integration    |                                 |
|                     | Lead           |                                 |
|                     +-------+--------+                                 |
|                                                                        |
+-----------------------------+------------------------------------------+
                              |
                              v
+-----------------------------+------------------------------------------+
| 6. Proof Gate                                                         |
|------------------------------------------------------------------------|
| tests | typecheck | scenarios | screenshots | verifier verdict | diff |
+-----------------------------+------------------------------------------+
                              |
                              v
+-------------------+     fail      +-------------------+
| Ship Decision     +-------------> | Repair Loop       |
|-------------------|              |-------------------|
| commit / PR       | <----------- | targeted fix graph |
| archive proof     |   pass       +-------------------+
+-------------------+
```

## Agent Roles

```text
                           +----------------+
                           | Mission Lead   |
                           |----------------|
                           | owns outcome   |
                           | updates graph  |
                           | asks humans    |
                           +-------+--------+
                                   |
          +------------------------+------------------------+
          |                         |                        |
          v                         v                        v
+------------------+      +------------------+      +------------------+
| Scout Agents     |      | Builder Agents   |      | Verifier Agents  |
|------------------|      |------------------|      |------------------|
| read-only        |      | write-scoped     |      | adversarial      |
| fast             |      | file-owned       |      | proof-seeking    |
| parallel         |      | checkpointed     |      | claim-based      |
| summarize facts  |      | small patches    |      | feedback loops   |
+------------------+      +------------------+      +------------------+
          |                         |                        |
          +-------------------------+------------------------+
                                    |
                                    v
                          +------------------+
                          | Integration Lead |
                          |------------------|
                          | merges outputs   |
                          | resolves drift   |
                          | runs final proof |
                          +------------------+
```

## Workcell Model

A workcell is the smallest executable unit of coding work.

```text
+------------------------------------------------------------------------+
| Workcell                                                               |
|------------------------------------------------------------------------|
| Mission slice: "Add retry persistence to orchestrator task runner"      |
| File scope:    apps/orchestrator/src/runner/*                           |
| Tools:         read, edit, test, typecheck                              |
| Policy:        no migrations, no env edits, no package installs         |
| Builder:       writes patch                                             |
| Verifier:      challenges claims and requests proof                     |
| Output:        patch + claims + evidence + remaining risks              |
+------------------------------------------------------------------------+
```

Workcells tighten the harness because they reduce ambiguity:

- every builder has a bounded file scope
- every verifier has explicit claims to check
- every policy decision is tied to a mission slice
- integration happens after local proof, not after blind parallel edits

## Claim-Based Verification

The redesigned harness should track claims as first-class state.

```text
+------------------------------------------------------------------------+
| Claim Ledger                                                            |
|------------------------------------------------------------------------|
| CLAIM                         OWNER        STATUS       PROOF           |
| retry is persisted             builder-api  proven       retry.test.ts   |
| duplicate charges impossible   verifier     challenged   missing test    |
| UI recovers after failure      builder-ui   pending      waiting shot    |
| no unrelated files changed     runtime      proven       git diff        |
+------------------------------------------------------------------------+
```

Verification becomes a loop:

```text
builder changes code
        |
        v
builder declares claim
        |
        v
verifier challenges claim
        |
        +---- proven --------+
        |                    |
        +---- needs proof ---+--> builder adds evidence
        |                    |
        +---- false --------+--> builder repairs
```

## Policy Kernel

The policy kernel is the safety layer around agent work.

```text
+-------------------+----------------------------------------------------+
| Policy Area       | Examples                                           |
+-------------------+----------------------------------------------------+
| Path protection   | block .env, node_modules, lockfiles unless allowed  |
| Tool limits       | read-only scouts, write-scoped builders             |
| Command approval  | migrations, package installs, destructive commands  |
| Risk profiles     | low, medium, high, human-required                   |
| Audit feed        | allowed, blocked, requested, escalated              |
+-------------------+----------------------------------------------------+
```

The dashboard should show policy events because they explain why the harness is
slowing down or asking for input.

## State Model

The old state is phase-centric:

```text
backlog -> brainstorming -> planning -> executing -> verifying -> ready_to_ship
```

The new state separates task lifecycle from runtime nodes.

```text
Task lifecycle:

  backlog
    |
    v
  active
    |
    +--> awaiting_user
    |
    +--> failed
    |
    +--> ready_to_ship
    |
    +--> done
    |
    +--> cancelled

Runtime node state:

  queued -> running -> blocked -> succeeded
                     \-> failed
                     \-> cancelled
```

This prevents the product from needing a new global task status for every new
workflow step.

## Performance Hypothesis

The redesign should improve harness performance because:

- context gathering becomes parallel and bounded
- code work is split into smaller, file-owned workcells
- verifier feedback starts before the final phase
- policy blocks unsafe work before damage occurs
- humans see concise gates instead of reading raw logs
- repair loops target failed claims instead of rerunning entire phases

