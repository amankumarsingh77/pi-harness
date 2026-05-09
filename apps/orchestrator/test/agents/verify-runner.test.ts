import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApiScenario } from "../../src/agents/verify-runner.js";

let server: Server;
let port = 0;
let proofDir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true }));
      return;
    }
    if (req.url === "/bad") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_signature" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
  proofDir = await mkdtemp(join(tmpdir(), "proof-"));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(proofDir, { recursive: true, force: true });
});

describe("runApiScenario", () => {
  it("passes when expected status matches", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "ok-200",
        type: "api",
        name: "ok",
        request: { method: "POST", url: `http://127.0.0.1:${port}/ok`, body: {} },
        expect: { status: 200, body_contains: ["received"] },
      },
      proofDir,
    });
    expect(result.ok).toBe(true);
    expect(result.evidence.status).toBe(200);
    expect(result.evidence.responseFile).toBeDefined();

    const responseBody = await readFile(
      join(proofDir, "responses", "ok-200.json"),
      "utf8",
    );
    expect(responseBody).toContain("received");
  });

  it("fails when status doesn't match", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "wrong-status",
        type: "api",
        name: "wrong",
        request: { method: "POST", url: `http://127.0.0.1:${port}/ok`, body: {} },
        expect: { status: 201 },
      },
      proofDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("status");
  });

  it("fails when body_contains is missing", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "no-keyword",
        type: "api",
        name: "x",
        request: { method: "POST", url: `http://127.0.0.1:${port}/ok`, body: {} },
        expect: { status: 200, body_contains: ["nope"] },
      },
      proofDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("body_contains");
  });
});
