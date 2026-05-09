import { describe, it, expect } from "vitest";
import { ScenarioFileSchema } from "../src/schemas/scenario.js";

describe("ScenarioFileSchema", () => {
  it("parses a valid api scenario", () => {
    const input = {
      scenarios: [
        {
          id: "api-1",
          type: "api",
          name: "GET /health returns 200",
          request: { method: "GET", url: "http://localhost:3000/health" },
          expect: { status: 200 },
        },
      ],
    };
    const parsed = ScenarioFileSchema.parse(input);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0]!.type).toBe("api");
  });

  it("parses a valid ui scenario", () => {
    const input = {
      scenarios: [
        {
          id: "ui-1",
          type: "ui",
          name: "login redirects",
          steps: [{ navigate: "http://localhost:3000/login" }],
          expect: { url_matches: "**/dashboard", screenshot: "ok.png" },
        },
      ],
    };
    expect(() => ScenarioFileSchema.parse(input)).not.toThrow();
  });

  it("rejects an unknown scenario type", () => {
    const input = { scenarios: [{ id: "x", type: "telepathy", name: "n" }] };
    expect(() => ScenarioFileSchema.parse(input)).toThrow();
  });

  it("rejects duplicate scenario ids", () => {
    const input = {
      scenarios: [
        { id: "dup", type: "api", name: "a", request: { method: "GET", url: "x" }, expect: { status: 200 } },
        { id: "dup", type: "api", name: "b", request: { method: "GET", url: "x" }, expect: { status: 200 } },
      ],
    };
    expect(() => ScenarioFileSchema.parse(input)).toThrow(/duplicate/i);
  });
});
