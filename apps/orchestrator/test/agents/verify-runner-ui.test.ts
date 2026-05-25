import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let currentUrl = "";

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => ({
      newPage: vi.fn(async () => ({
        goto: vi.fn(async (url: string) => {
          currentUrl = url;
        }),
        fill: vi.fn(async () => {}),
        click: vi.fn(async () => {
          currentUrl = `${currentUrl}#dashboard`;
        }),
        waitForURL: vi.fn(async () => {}),
        url: vi.fn(() => currentUrl),
        screenshot: vi.fn(async () => {}),
        locator: vi.fn(() => ({
          screenshot: vi.fn(async () => {}),
        })),
      })),
      close: vi.fn(async () => {}),
    })),
  },
}));

import { runUiScenario, runUiVisualScenario } from "../../src/agents/verify-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "..", "fixtures", "ui");
const fixtureUrl = pathToFileURL(join(fixtureDir, "index.html")).toString();
const fixtureBaseUrl = pathToFileURL(`${fixtureDir}/`).toString();

let proofDir: string;

beforeAll(async () => {
  proofDir = await mkdtemp(join(tmpdir(), "ui-proof-"));
});

afterAll(async () => {
  await rm(proofDir, { recursive: true, force: true });
});

describe("runUiScenario (Playwright)", () => {
  it("walks steps, asserts url, captures screenshot", async () => {
    const result = await runUiScenario({
      scenario: {
        id: "login-success",
        type: "ui",
        name: "login flow",
        steps: [
          { navigate: fixtureUrl },
          { fill: { selector: "input[name=email]", value: "u@x" } },
          { fill: { selector: "input[name=password]", value: "p" } },
          { click: "button[type=button]" },
          { wait_for_url: "**#dashboard" },
        ],
        expect: { url_matches: "**#dashboard", screenshot: "login.png" },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.screenshotFile).toContain("login.png");
  });

  it("resolves relative navigation steps against the UI base URL", async () => {
    const result = await runUiScenario({
      scenario: {
        id: "relative-login",
        type: "ui",
        name: "relative login flow",
        steps: [
          { navigate: "index.html" },
          { fill: { selector: "input[name=email]", value: "u@x" } },
          { fill: { selector: "input[name=password]", value: "p" } },
          { click: "button[type=button]" },
          { wait_for_url: "**#dashboard" },
        ],
        expect: { url_matches: "**#dashboard", screenshot: "relative-login.png" },
      },
      proofDir,
      baseUrl: fixtureBaseUrl,
    });

    expect(result.ok).toBe(true);
  });

  it("ui-visual scenario captures the named file", async () => {
    const result = await runUiVisualScenario({
      scenario: {
        id: "home-shot",
        type: "ui-visual",
        name: "home",
        steps: [{ navigate: fixtureUrl }],
        capture: { full_page: true, filename: "home.png" },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.screenshotFile).toContain("home.png");
  });
});
