# Mission Packet + Claim Ledger Implementation Status

## Current Phase

Phase 2 implementation is complete and validated: Mission Command is discoverable from task detail, consumes task-scoped live events, and updates mission/claim state without manual refresh. Phase 1 file-backed Mission Packet and Claim Ledger remain intact.

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

## Pending Checklist

- Force-add this document when staging because `docs/` is currently ignored.
- Consider adding claim status controls in the UI after the verifier sidecar design is approved.
- Decide whether broader task pages should share the task-scoped live provider introduced for Mission Command.

## Known Blockers

- Orchestrator HTTP tests require local Postgres access. In the Codex sandbox they can fail with `EPERM`; rerun those tests with approved sandbox escalation.
- Playwright smoke tests can accidentally reuse a stale server on default ports. Use fresh `DASHBOARD_E2E_PORT` and `ORCHESTRATOR_E2E_PORT` values when validating locally.
- No blocker for the Mission Command live surface itself.

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

## Next Recommended Task

Start the verifier sidecar slice: consume the claim ledger as the verifier's assignment list, write evidence/status updates back through the claim status API, and surface challenged/proven transitions live in Mission Command.
