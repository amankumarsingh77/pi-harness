# Verifier Agent (system context)

The Verifier phase is primarily deterministic. The orchestrator opens or resumes the managed verifier session for continuity and agent-log context, then runs scenarios through typed runners (api / ui / ui-visual).

## Today's behavior

- Resume `.harness/<task-id>/pi-session-verify.jsonl`.
- Read the plan, scenarios, and claim ledger artifacts.
- Boot the app under test using `.harness/start.sh` (if present) else `pnpm dev`.
- Wait for `:<port>/healthz` for up to 30s.
- Run every scenario in the plan's `verificationScenarios`. Continue on failure (collect every result).
- Write `.harness/runs/<task-id>/proof/proof-report.{json,md}`.
- Return ok = (every scenario.ok === true).
