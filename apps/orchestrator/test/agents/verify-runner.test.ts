import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApiScenario } from "../../src/agents/verify-runner.js";

let proofDir: string;

beforeAll(async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/ok") && init?.method === "POST") {
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/bad")) {
      return new Response(JSON.stringify({ error: "bad_signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  });
  proofDir = await mkdtemp(join(tmpdir(), "proof-"));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await rm(proofDir, { recursive: true, force: true });
});

describe("runApiScenario", () => {
  it("passes when expected status matches", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "ok-200",
        type: "api",
        name: "ok",
        request: { method: "POST", url: "https://example.test/ok", body: {} },
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

  it("resolves root-relative request URLs against the API base URL", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "relative-ok",
        type: "api",
        name: "relative ok",
        request: { method: "POST", url: "/ok", body: {} },
        expect: { status: 200, body_contains: ["received"] },
      },
      proofDir,
      baseUrl: "https://example.test",
    });

    expect(result.ok).toBe(true);
  });

  it("fails when status doesn't match", async () => {
    const result = await runApiScenario({
      scenario: {
        id: "wrong-status",
        type: "api",
        name: "wrong",
        request: { method: "POST", url: "https://example.test/ok", body: {} },
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
        request: { method: "POST", url: "https://example.test/ok", body: {} },
        expect: { status: 200, body_contains: ["nope"] },
      },
      proofDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("body_contains");
  });
});
