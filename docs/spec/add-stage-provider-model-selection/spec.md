# SPEC: Stage Provider/Model Selection

**Source:** docs/spec/add-stage-provider-model-selection/design.md
**Generated:** 2026-05-30

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The system shall expose a model catalog containing pi built-in providers/models and code-owned custom providers/models. | `GET /api/model-options` returns at least one built-in provider and the CrofAI provider with its configured models. | Must |
| REQ-002 | Ubiquitous | The system shall report credential requirements for every provider in the model catalog without returning secret values. | The catalog response includes env var names and availability booleans, and no response field contains an API key value. | Must |
| REQ-003 | Event-driven | When the new task page renders, the system shall display provider/model controls for brainstorm, plan, code, verify, and PR phases. | The form contains one provider select and one model select per phase, with labels for all five phases. | Must |
| REQ-004 | Event-driven | When a user submits the new task form, the system shall persist selected phase model overrides with the created task. | A created task response includes `phaseModels` matching the selected provider/model pairs. | Must |
| REQ-005 | State-driven | While any selected env-backed provider is missing its required env var, the system shall disable task creation. | The Create task button is disabled and no submit is possible through the rendered button. | Must |
| REQ-006 | State-driven | While any selected provider credential is missing, the system shall show a compact warning naming the missing credential. | The warning includes the phase label, provider label, and missing env var or login requirement. | Must |
| REQ-007 | Event-driven | When the user clicks refresh in the credential warning, the system shall refetch credential state without clearing current form input or selected phase controls. | After refresh, title, description, tags, priority, and selected provider/model values remain unchanged unless a selected provider/model no longer exists. | Must |
| REQ-008 | Ubiquitous | The system shall use the selected planning model for plan preflight agents. | Plan preflight session creation receives the same provider/model as `mergePhaseModels(task.phaseModels, "plan")`. | Must |
| REQ-009 | Unwanted | If the catalog fetch fails, then the system shall prevent task creation and keep form state intact. | The selector shows a retry warning, the submit button is disabled, and previously typed text remains in the DOM. | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Provider has no models. | Provider is omitted from the selectable catalog. | REQ-001 |
| EDGE-002 | Provider has multiple possible env vars. | Any present non-empty env var marks the provider available; all accepted names are listed. | REQ-002 |
| EDGE-003 | Selected provider disappears after refresh. | The affected phase falls back to the first catalog provider/model; unrelated form inputs remain unchanged. | REQ-007 |
| EDGE-004 | Selected model disappears after refresh. | The affected phase keeps its provider and falls back to that provider's first model. | REQ-007 |
| EDGE-005 | Provider uses OAuth instead of env vars. | Warning asks for login instead of an env var; create is disabled while unavailable. | REQ-006 |
| EDGE-006 | JavaScript-disabled or crafted POST omits phase models. | Backend creates a task with defaults through existing `DEFAULT_PHASE_MODELS` behavior. | REQ-004 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | Yes | No | No | pi-bridge catalog unit plus orchestrator route integration. |
| REQ-002 | Yes | Yes | No | No | Assert metadata only, no secret values. |
| REQ-003 | Yes | No | Yes | No | Dashboard component test and browser verification on `/tasks/new`. |
| REQ-004 | Yes | Yes | Yes | No | Server action/API route persists selected `phaseModels`. |
| REQ-005 | Yes | No | Yes | No | Dashboard component and browser verification with missing env state. |
| REQ-006 | Yes | No | Yes | No | Warning copy and credential names visible. |
| REQ-007 | Yes | No | Yes | No | Refresh keeps form/selection state. |
| REQ-008 | Yes | No | No | No | Existing plan-preflight test coverage extended for plan phase model propagation. |
| REQ-009 | Yes | No | Yes | No | Component fetch-failure state. |

| EDGE ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|---------|-----------|-----------------|----------|-------------|-------|
| EDGE-001 | Yes | No | No | No | Catalog builder omits empty providers. |
| EDGE-002 | Yes | No | No | No | Env availability helper. |
| EDGE-003 | Yes | No | No | No | Selector reconciliation unit/component test. |
| EDGE-004 | Yes | No | No | No | Selector reconciliation unit/component test. |
| EDGE-005 | Yes | No | No | No | OAuth credential-kind rendering. |
| EDGE-006 | Yes | Yes | No | No | Create route default behavior. |

## Verification Scenarios

- VS-001: With `CROFAI_API_KEY` absent, open `/tasks/new`, select CrofAI for one phase, verify Create task is disabled, the warning names `CROFAI_API_KEY`, type text, click Refresh, and verify typed text remains.
- VS-002: With a catalog containing an available provider, select different models for each phase, create a task, and verify persisted `task.phaseModels` contains all five phase overrides.
- VS-003: Create a task with a plan override and verify plan preflight session options use that plan provider/model.

## Out of Scope

- Editing phase model overrides after task creation beyond the existing metadata patch path.
- Creating or editing Pi `models.json` from the dashboard.
- Displaying secret values or validating that a credential can successfully call the remote provider.
