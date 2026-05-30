# Adversarial Findings: Stage Provider/Model Selection

## Checks Performed

- Started the dashboard with the copied worktree `.env.harness` temporarily hidden to simulate a missing `CROFAI_API_KEY`.
- Confirmed the default CrofAI selection shows a credential warning and disables task creation.
- Restored `.env.harness` while keeping the page open, clicked Refresh, and confirmed the warning cleared.
- Confirmed existing title and description values remained unchanged after Refresh.
- Confirmed Create task became enabled only after the selected provider credential was available.
- Verified the new `GET /api/model-options` API does not expose secret values.
- Verified task creation persists `phaseModels` immediately.
- Verified plan pre-flight agents receive the selected planning model config.

## Edge Cases Covered

- Empty or unavailable provider catalog keeps task creation disabled.
- Provider selection falling out of the refreshed catalog reconciles to an available fallback.
- Provider-specific credential requirements support env vars, OAuth-style guidance, and ambient Pi credentials.
- Empty process env vars do not mask credentials that are added later to `.env.harness`.
- Refresh failure does not clear user input and leaves creation blocked.

## Residual Risk

- OAuth-backed providers report guidance instead of probing an interactive Pi login session. This avoids false secret exposure, but the UI will remain blocked until the catalog can determine configured OAuth state.
