export type ApiScenario = {
  id: string;
  type: "api";
  name: string;
  requirementRefs?: string[] | undefined;
  blastRadiusRefs?: string[] | undefined;
  setup?: { bash: string }[] | undefined;
  request: { method: string; url: string; headers?: Record<string, string> | undefined; body?: unknown };
  expect: { status: number; body_contains?: string[] | undefined };
};

export type UiStep =
  | { navigate: string }
  | { fill: { selector: string; value: string } }
  | { click: string }
  | { wait_for_url: string };

export type UiScenario = {
  id: string;
  type: "ui";
  name: string;
  requirementRefs?: string[] | undefined;
  blastRadiusRefs?: string[] | undefined;
  setup?: { bash: string }[] | undefined;
  steps: UiStep[];
  expect: { url_matches?: string | undefined; screenshot?: string | undefined };
};

export type UiVisualScenario = {
  id: string;
  type: "ui-visual";
  name: string;
  requirementRefs?: string[] | undefined;
  blastRadiusRefs?: string[] | undefined;
  steps: UiStep[];
  capture: { selector?: string | undefined; full_page?: boolean | undefined; filename: string };
};

export type Scenario = ApiScenario | UiScenario | UiVisualScenario;

export type ScenarioFile = { scenarios: Scenario[] };
