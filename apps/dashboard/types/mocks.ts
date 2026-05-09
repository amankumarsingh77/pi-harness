// UI-only mock types. Values live in lib/server/_fixtures/* (server-only).
// These shapes describe fields the orchestrator doesn't yet emit; once the
// backend gains them, promote into @pi-harness/shared and delete this file.

export type MockSubagent = {
  name: string;
  status: "done" | "active" | "queued";
  durationMs: number | null;
};

export type MockFileTouched = {
  path: string;
  added: number;
  removed: number;
  state: "live" | "settled";
};

export type MockRunHistoryEntry = {
  runId: string;
  label: string;
  kind: "progress" | "blocked" | "done" | "shipping" | "review";
  age: string;
  current: boolean;
};

export type MockDeepLinks = {
  brainstorm: { available: true; href: string } | { available: false; reason: string };
  plan: { available: true; href: string } | { available: false; reason: string };
  verify: { available: true; href: string } | { available: false; reason: string };
};

export type MockPlanFileChange = {
  op: "new" | "edit" | "del";
  path: string;
  why: string;
  delta: string;
};

export type MockPlanRisk = {
  level: "high" | "normal";
  body: string;
};

export type MockPlanOpenQuestion = {
  id: string;
  body: string;
};

export type MockPlanScenarioKind = "unit" | "api" | "visual";
export type MockPlanScenarioSource = "library" | "new";

export type MockPlanScenario = {
  id: string;
  kind: MockPlanScenarioKind;
  source: MockPlanScenarioSource;
  name: string;
  expression: string;
  enabled: boolean;
};

export type MockPlanGate =
  | {
      state: "approved";
      enabledCount: number;
      totalCount: number;
      planRev: string;
      coderPickedUpAt: string;
    }
  | { state: "pending" };

export type MockPlan = {
  taskId: string;
  taskTitle: string;
  phaseDurationLabel: string;
  authoredBy: string;
  approachParagraphs: string[];
  fileChanges: MockPlanFileChange[];
  risks: MockPlanRisk[];
  openQuestions: MockPlanOpenQuestion[];
  scenarios: MockPlanScenario[];
  gate: MockPlanGate;
};

export type RunOutcome =
  | { kind: "running"; phase: string }
  | { kind: "blocked"; phase: string; note: string }
  | { kind: "review"; phase: string }
  | { kind: "shipping"; phase: string; pr: number }
  | { kind: "merged"; pr: number }
  | { kind: "failed"; phase: string }
  | { kind: "abandoned"; phase: string };

export type MockRun = {
  id: string;
  taskId: string;
  taskTitle: string;
  attempt: number;
  branch: string;
  startedAt: string;
  durationMs: number;
  outcome: RunOutcome;
};
