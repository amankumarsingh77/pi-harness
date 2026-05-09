export type ApiScenario = {
  id: string;
  type: "api";
  name: string;
  setup?: { bash: string }[];
  request: { method: string; url: string; headers?: Record<string, string>; body?: unknown };
  expect: { status: number; body_contains?: string[] };
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
  setup?: { bash: string }[];
  steps: UiStep[];
  expect: { url_matches?: string; screenshot?: string };
};

export type UiVisualScenario = {
  id: string;
  type: "ui-visual";
  name: string;
  steps: UiStep[];
  capture: { selector?: string; full_page?: boolean; filename: string };
};

export type Scenario = ApiScenario | UiScenario | UiVisualScenario;

export type ScenarioFile = { scenarios: Scenario[] };
