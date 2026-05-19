# Mission Packet + Claim Ledger Implementation Status

## Current Phase

Phase 3 implementation is complete and validated: Verifier Sidecar consumes scenario-backed Claim Ledger entries, runs typed scenarios, writes claim evidence/status updates, and streams proof transitions into Mission Command. Phase 1 file-backed Mission Packet and Claim Ledger and Phase 2 Mission Command live surface remain intact.

## Completed Checklist

- Created implementation branch: `codex/mission-packet-claim-ledger`.
- Added shared Zod schemas and types for `MissionPacket`, `Claim`, `ClaimEvent`, and `MissionEvent`.
- Added claim folding with deterministic source-key de-duplication, evidence accumulation, status updates, and malformed/torn JSONL handling in store reads.
- Added `MissionStore` for `.harness/tasks/<taskId>/mission.json` and `mission-events.jsonl`.
- Added `ClaimLedgerStore` for `.harness/tasks/<taskId>/claims.jsonl`.
- Added `HARNESS_STATE_DIR` config support with `.harness` default.
- Added mission APIs:
  - `GET /api/tasks/:id/mission`
  - `PATCH /api/tasks/:id/mission`
  - `POST /api/tasks/:id/claims/:claimId/status`
- Initialized mission state on task creation.
- Added idempotent mission repair for old tasks on first mission read.
- Synced initial claims when plan `mark_ready` succeeds from:
  - `execution-dag:<nodeId>`
  - `scenario:<scenarioId>`
- Extended shared live event types with `mission.updated` and `claims.updated`.
- Added Mission Command page shell at `/tasks/[id]/mission` with mission summary, runtime status, claim/proof ledger, filtered mission transcript, and policy kernel stub.
- Added targeted tests for shared schemas/folding, stores, mission routes, plan claim sync, dashboard API hydration, and Mission Command rendering.
- Fixed the production plan-phase wiring so `runPhase("plan")` passes the claim ledger into `runPlan`.
- Extended mission API responses with `claimEvents`.
- Extended `claims.updated` live events with appended claim events.
- Changed mission reads to repair missing files without broadcasting live updates.
- Added live claim updates after claim status changes and after successful `mark_ready` claim sync when new claims are created.
- Added a Mission Command entry point from the task detail header and a Task overview return action from Mission Command.
- Added `MissionCommandLive` to subscribe to `/api/live/stream?taskId=:id` and patch task, run, mission, and claim query state.
- Added a combined mission/claim transcript in Mission Command.
- Added dashboard proxy `PATCH` support for browser-facing mission mutations.
- Added a focused Playwright smoke test for Mission Command live mission updates.
- Added `runVerifierSidecar` to consume `scenario:<scenarioId>` claims from the Claim Ledger.
- Added scenario proof report output under `.harness/<taskId>/proof/claim-verifier-report.json` and `.md`.
- Added claim status mapping from scenario results:
  - passing scenarios mark claims `proven`
  - failing scenarios mark claims `challenged`
  - missing/malformed `scenarios.yaml` fails without claim mutations
- Added `POST /api/tasks/:id/verifier/run` for deterministic manual verifier runs.
- Wired `runPhase("verify")` to the same verifier sidecar path.
- Added Mission Command "Run verifier" action that posts through the dashboard proxy and relies on task-scoped live claim updates.
- Extended the Mission Command Playwright smoke to seed a scenario-backed claim, run the verifier, and observe the claim transition live.

## Pending Checklist

- Force-add this document when staging because `docs/` is currently ignored.
- Decide whether manual claim status controls are still needed now that scenario claims can be verifier-driven.
- Decide whether broader task pages should share the task-scoped live provider introduced for Mission Command.
- Design the repair-loop handoff for challenged claims after verifier failure.

## Known Blockers

- Orchestrator full-package tests require local Postgres access. In the Codex sandbox they can fail with `EPERM`; start local infra and rerun with approved sandbox escalation.
- Playwright smoke tests can accidentally reuse stale default servers. Use fresh `DASHBOARD_E2E_PORT` and `ORCHESTRATOR_E2E_PORT` values when validating locally.
- No blocker for the Verifier Sidecar slice itself.

## Validation Commands And Latest Results

- `pnpm --filter @pi-harness/shared test -- src/types/mission.test.ts` - passed.
- `pnpm --filter @pi-harness/shared build` - passed.
- `pnpm --filter @pi-harness/orchestrator test -- test/mission-store.test.ts` - passed.
- `pnpm --filter @pi-harness/orchestrator test -- test/agents/plan-tools.test.ts` - passed.
- `pnpm --filter @pi-harness/orchestrator test -- test/http-mission.test.ts` - passed with sandbox escalation for local Postgres.
- `pnpm --filter @pi-harness/dashboard test -- test/lib/api.test.ts test/components/mission-command-shell.test.tsx` - passed.
- `pnpm --filter @pi-harness/orchestrator test -- test/mission-store.test.ts test/agents/plan-tools.test.ts test/phase-prompts.test.ts` - passed, 3 files / 31 tests.
- `pnpm --filter @pi-harness/dashboard test -- test/components/mission-command-live.test.tsx` - passed, 1 file / 4 tests.
- `pnpm --filter @pi-harness/orchestrator test -- test/http-mission.test.ts test/sse.test.ts` - failed in normal sandbox with local Postgres/socket `EPERM`; passed with sandbox escalation, 2 files / 8 tests.
- `pnpm --filter @pi-harness/shared test` - passed, 10 files / 62 tests.
- `pnpm --filter @pi-harness/dashboard test` - passed, 20 files / 152 tests.
- `pnpm --filter @pi-harness/orchestrator test` - failed in normal sandbox with local Postgres and socket `EPERM`; passed with sandbox escalation, 42 files / 339 tests.
- `pnpm typecheck` - passed, 11 Turbo tasks.
- `DASHBOARD_E2E_PORT=3107 ORCHESTRATOR_E2E_PORT=4107 pnpm --filter @pi-harness/dashboard test:e2e mission-command.spec.ts` - passed, 1 Playwright smoke test.
- `DASHBOARD_E2E_PORT=3108 ORCHESTRATOR_E2E_PORT=4108 pnpm --filter @pi-harness/dashboard test:e2e -- mission-command.spec.ts` - passed, 1 Playwright smoke test with the requested command form.
- `pnpm --filter @pi-harness/orchestrator test -- test/agents/verifier-sidecar.test.ts test/phase-prompts.test.ts` - passed, 2 files / 7 tests.
- `pnpm --filter @pi-harness/orchestrator test -- test/http-verifier.test.ts` - passed, 1 file / 3 tests.
- `pnpm --filter @pi-harness/dashboard test -- test/lib/api.test.ts test/components/mission-command-shell.test.tsx test/components/mission-command-live.test.tsx` - passed, 3 files / 12 tests.
- `pnpm --filter @pi-harness/shared test` - passed, 10 files / 62 tests.
- `pnpm --filter @pi-harness/dashboard test` - passed, 20 files / 154 tests.
- `pnpm infra:up` - passed with sandbox escalation; started `pi-harness-postgres` and `pi-harness-searxng`.
- `pnpm --filter @pi-harness/orchestrator test` - passed with sandbox escalation, 44 files / 348 tests.
- `DASHBOARD_E2E_PORT=3110 ORCHESTRATOR_E2E_PORT=4110 pnpm --filter @pi-harness/dashboard test:e2e -- mission-command.spec.ts` - passed, 2 Playwright smoke tests.
- `pnpm typecheck` - passed, 11 Turbo tasks.

## Next Recommended Task

Start the repair-loop handoff slice: convert challenged verifier claims into actionable repair inputs for the code phase, preserve the verifier evidence in Mission Command, and make Proof Gate ship-readiness depend on unresolved claim state.
