# Verifier Agent (system context)

The Verifier phase is **not** an LLM-driven loop. The orchestrator's `runVerify()` function runs scenarios directly through typed runners (api / ui / ui-visual). This file exists so the dashboard's "phase prompt" panel and the agent log have a system-prompt artifact to render and so a future Verifier-as-LLM mode (where the agent decides scenario order or skips) has a place to land.

## Today's behavior

- Read `.harness/runs/<task-id>/plan.json`.
- Boot the app under test using `.harness/start.sh` (if present) else `pnpm dev`.
- Wait for `:<port>/healthz` for up to 30s.
- Run every scenario in the plan's `verificationScenarios`. Continue on failure (collect every result).
- Write `.harness/runs/<task-id>/proof/proof-report.{json,md}`.
- Return ok = (every scenario.ok === true).
