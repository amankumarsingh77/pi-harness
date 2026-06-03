import type { Scenario, ScenarioResult } from "@pi-harness/shared";

// TODO(agentic-verify): These deterministic runners were retired when the
// scenario format became a textual brief (id + type + name + description). A
// scenario no longer carries request/steps/expect/capture for a runner to
// replay. The follow-up plan replaces this module with a verifier *agent*
// session that reads each brief, sets up the environment, drives the behavior
// via the appropriate tools (Playwright, a DB client, a CLI), and reports a
// verdict backed by captured evidence.
//
// Until then these stubs keep the build green and, critically, never report a
// false pass: every scenario comes back ok:false with an explicit reason.

const NOT_IMPLEMENTED = "agentic verifier not yet implemented";

function notImplemented(scenario: Scenario, type: string): ScenarioResult {
  return {
    id: scenario.id,
    type: scenario.type || type,
    ok: false,
    error: NOT_IMPLEMENTED,
    evidence: {},
    durationMs: 0,
  };
}

export function runApiScenario(opts: {
  scenario: Scenario;
  proofDir: string;
  baseUrl?: string;
}): Promise<ScenarioResult> {
  return Promise.resolve(notImplemented(opts.scenario, "api"));
}

export function runUiScenario(opts: {
  scenario: Scenario;
  proofDir: string;
  baseUrl?: string;
}): Promise<ScenarioResult> {
  return Promise.resolve(notImplemented(opts.scenario, "ui"));
}

export function runUiVisualScenario(opts: {
  scenario: Scenario;
  proofDir: string;
  baseUrl?: string;
}): Promise<ScenarioResult> {
  return Promise.resolve(notImplemented(opts.scenario, "ui-visual"));
}
