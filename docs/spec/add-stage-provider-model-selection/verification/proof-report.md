# Proof Report: Stage Provider/Model Selection

## Scope

Verified the new task page lets users choose a provider and model for each workflow stage, blocks task creation when the selected provider is missing credentials, and refreshes credential state without clearing existing form input.

## Automated Checks

```bash
pnpm --filter @pi-harness/pi-bridge test -- src/model-catalog.test.ts
```

Result: passed, 3 tests.

```bash
pnpm --filter @pi-harness/pi-bridge test
```

Result: passed, 4 files, 30 tests.

```bash
pnpm --filter @pi-harness/dashboard test -- test/components/stage-model-selector.test.tsx
```

Result: passed, 3 tests.

```bash
pnpm --filter @pi-harness/orchestrator test -- test/http.test.ts test/agents/plan-preflight.test.ts
```

Result: passed, 65 tests.

```bash
pnpm typecheck
```

Result: passed, 9 workspace tasks.

```bash
pnpm test
```

Result: passed, 9 workspace tasks. Dashboard: 172 tests. Orchestrator: 412 tests. Pi bridge: 30 tests.

## Browser Verification

Local app was run from the feature worktree on alternate ports:

```bash
PORT=4101 pnpm --filter @pi-harness/orchestrator dev
ORCHESTRATOR_URL=http://localhost:4101 pnpm --filter @pi-harness/dashboard exec next dev -p 3101
```

Headless Playwright verification against `http://localhost:3101/tasks/new` passed with:

```json
{
  "warningBefore": true,
  "disabledBefore": true,
  "disabledAfter": false,
  "titlePreserved": true,
  "descriptionPreserved": true
}
```

Evidence:

- Missing credential state: `docs/spec/add-stage-provider-model-selection/verification/screenshots/stage-model-selector-missing-key.png`
- Refreshed credential state: `docs/spec/add-stage-provider-model-selection/verification/screenshots/stage-model-selector.png`

## Acceptance Criteria Mapping

- Stage selectors exist for Brainstorm, Planning, Coder, Verify, and PR.
- Provider/model selection serializes through the new task form as `phaseModels`.
- Planning selection is used by plan pre-flight subagents.
- Model catalog includes Pi supported providers/models and custom CrofAI provider metadata.
- Missing selected provider credentials disable Create task.
- Warning identifies the missing env var and asks the user to add it before refreshing.
- Refresh refetches env-derived credential state and preserves typed title/description.
- No secret env values are returned by the model catalog API.
