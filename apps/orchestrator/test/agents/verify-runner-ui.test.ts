import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runUiScenario, runUiVisualScenario } from "../../src/agents/verify-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let server: Server;
let port = 0;
let proofDir: string;

beforeAll(async () => {
  server = createServer(async (_req, res) => {
    const html = await readFile(join(__dirname, "..", "fixtures", "ui", "index.html"));
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
  proofDir = await mkdtemp(join(tmpdir(), "ui-proof-"));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
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
          { navigate: `http://127.0.0.1:${port}/` },
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

  it("ui-visual scenario captures the named file", async () => {
    const result = await runUiVisualScenario({
      scenario: {
        id: "home-shot",
        type: "ui-visual",
        name: "home",
        steps: [{ navigate: `http://127.0.0.1:${port}/` }],
        capture: { full_page: true, filename: "home.png" },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.screenshotFile).toContain("home.png");
  });
});
