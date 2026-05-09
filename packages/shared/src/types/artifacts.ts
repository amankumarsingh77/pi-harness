import type { Workflow } from "./task.js";
import type { ScenarioFile } from "./scenario.js";

export type BrainstormTurn = { role: "agent" | "user"; text: string; ts: string };

export type BrainstormArtifact = {
  goal: string;
  decisions: string[];
  openQuestions: string[];
  suggestedWorkflow: Workflow;
  transcript: BrainstormTurn[];
};

export type PlanStep = {
  id: string;
  title: string;
  files: { path: string; action: "create" | "modify" }[];
  patternRef?: string; // e.g. "src/auth/login.ts:42 — model after this"
  assertion: string; // what proves this step is done
};

export type PlanArtifact = {
  goal: string;
  patternsToFollow: { ref: string; note: string }[];
  touchpoints: { layer: string; files: string[]; finding: string }[];
  blastRadius: string[];
  precedentWarnings: { ref: string; lesson: string }[];
  steps: PlanStep[];
  verificationScenarios: ScenarioFile;
  outOfScope: string[];
  suggestedWorkflow: Workflow;
};

export type ScenarioResult = {
  id: string;
  type: "api" | "ui" | "ui-visual";
  ok: boolean;
  durationMs?: number;
  error?: string;
  evidence: {
    responseFile?: string;
    screenshotFile?: string;
    status?: number;
  };
};

export type ProofReport = {
  runId: string;
  ok: boolean;
  scenarios: ScenarioResult[];
  startedAt?: string;
  endedAt?: string;
};
