import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import type {
  ApiScenario,
  ScenarioResult,
  UiScenario,
  UiStep,
  UiVisualScenario,
} from "@pi-harness/shared";

// Runs a single api scenario against a live HTTP endpoint. Writes the response
// body to <proofDir>/responses/<id>.json regardless of pass/fail (the
// dashboard's verification panel renders this).
export async function runApiScenario(opts: {
  scenario: ApiScenario;
  proofDir: string;
  baseUrl?: string;
}): Promise<ScenarioResult> {
  const { scenario, proofDir } = opts;
  const start = Date.now();

  const init: RequestInit = { method: scenario.request.method };
  if (scenario.request.headers !== undefined) {
    init.headers = scenario.request.headers;
  }
  if (scenario.request.body !== undefined) {
    init.body = JSON.stringify(scenario.request.body);
  }

  let response: Response;
  try {
    response = await fetch(resolveUrl(scenario.request.url, opts.baseUrl ?? defaultApiBaseUrl()), init);
  } catch (e) {
    return {
      id: scenario.id,
      type: "api",
      ok: false,
      error: `network: ${(e as Error).message}`,
      evidence: {},
      durationMs: Date.now() - start,
    };
  }

  const bodyText = await response.text();
  const responsesDir = join(proofDir, "responses");
  await mkdir(responsesDir, { recursive: true });
  const responseFile = join("responses", `${scenario.id}.json`);
  await writeFile(join(proofDir, responseFile), bodyText);

  if (response.status !== scenario.expect.status) {
    return {
      id: scenario.id,
      type: "api",
      ok: false,
      error: `expected status ${scenario.expect.status}, got ${response.status}`,
      evidence: { status: response.status, responseFile },
      durationMs: Date.now() - start,
    };
  }

  if (scenario.expect.body_contains?.length) {
    for (const needle of scenario.expect.body_contains) {
      if (!bodyText.includes(needle)) {
        return {
          id: scenario.id,
          type: "api",
          ok: false,
          error: `body_contains failed: missing "${needle}"`,
          evidence: { status: response.status, responseFile },
          durationMs: Date.now() - start,
        };
      }
    }
  }

  return {
    id: scenario.id,
    type: "api",
    ok: true,
    evidence: { status: response.status, responseFile },
    durationMs: Date.now() - start,
  };
}

async function walkSteps(page: Page, steps: UiStep[], baseUrl: string): Promise<void> {
  for (const step of steps) {
    if ("navigate" in step) await page.goto(resolveUrl(step.navigate, baseUrl));
    else if ("fill" in step) await page.fill(step.fill.selector, step.fill.value);
    else if ("click" in step) await page.click(step.click);
    else if ("wait_for_url" in step) await page.waitForURL(step.wait_for_url);
  }
}

export async function runUiScenario(opts: {
  scenario: UiScenario;
  proofDir: string;
  baseUrl?: string;
}): Promise<ScenarioResult> {
  const { scenario, proofDir } = opts;
  const start = Date.now();
  const screenshotName = scenario.expect.screenshot ?? `${scenario.id}.png`;
  const screenshotFile = join("screenshots", screenshotName);
  await mkdir(join(proofDir, "screenshots"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await walkSteps(page, scenario.steps, opts.baseUrl ?? defaultUiBaseUrl());

    if (scenario.expect.url_matches) {
      const url = page.url();
      const matched = matchesGlob(url, scenario.expect.url_matches);
      if (!matched) {
        await page.screenshot({ path: join(proofDir, screenshotFile), fullPage: false });
        return {
          id: scenario.id,
          type: "ui",
          ok: false,
          error: `url_matches failed: ${url} !~ ${scenario.expect.url_matches}`,
          evidence: { screenshotFile },
          durationMs: Date.now() - start,
        };
      }
    }

    await page.screenshot({ path: join(proofDir, screenshotFile), fullPage: false });

    return {
      id: scenario.id,
      type: "ui",
      ok: true,
      evidence: { screenshotFile },
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }
}

export async function runUiVisualScenario(opts: {
  scenario: UiVisualScenario;
  proofDir: string;
  baseUrl?: string;
}): Promise<ScenarioResult> {
  const { scenario, proofDir } = opts;
  const start = Date.now();
  const screenshotFile = join("screenshots", scenario.capture.filename);
  await mkdir(join(proofDir, "screenshots"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await walkSteps(page, scenario.steps, opts.baseUrl ?? defaultUiBaseUrl());

    if (scenario.capture.selector) {
      const handle = page.locator(scenario.capture.selector);
      await handle.screenshot({ path: join(proofDir, screenshotFile) });
    } else {
      await page.screenshot({
        path: join(proofDir, screenshotFile),
        fullPage: scenario.capture.full_page === true,
      });
    }
    return {
      id: scenario.id,
      type: "ui-visual",
      ok: true,
      evidence: { screenshotFile },
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      id: scenario.id,
      type: "ui-visual",
      ok: false,
      error: (e as Error).message,
      evidence: {},
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }
}

// Tiny glob matcher — handles `**` for any-segments, no other wildcards.
function matchesGlob(url: string, pattern: string): boolean {
  const DOUBLESTAR = "__PI_HARNESS_DOUBLESTAR__";
  const SINGLESTAR = "__PI_HARNESS_SINGLESTAR__";
  const re = new RegExp(
    "^" +
      pattern
        .replace(/\*\*/g, DOUBLESTAR)
        .replace(/\*/g, SINGLESTAR)
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(new RegExp(DOUBLESTAR, "g"), ".*")
        .replace(new RegExp(SINGLESTAR, "g"), "[^/]*") +
      "$",
  );
  return re.test(url);
}

function resolveUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

function defaultApiBaseUrl(): string {
  return process.env.ORCHESTRATOR_URL ?? `http://localhost:${process.env.PORT ?? "4000"}`;
}

function defaultUiBaseUrl(): string {
  return process.env.DASHBOARD_URL ?? `http://localhost:${process.env.DASHBOARD_PORT ?? "3000"}`;
}
