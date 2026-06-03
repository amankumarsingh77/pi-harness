import { describe, it, expect } from "vitest";
import { ScenarioFileSchema } from "../src/schemas/scenario.js";

const brief =
  "Open the filter dropdown in the toolbar, click outside it, and verify the dropdown is dismissed.";

describe("ScenarioFileSchema", () => {
  it("parses a valid scenario brief", () => {
    const input = {
      scenarios: [
        { id: "S-001", type: "ui", name: "filter dropdown closes", description: brief },
      ],
    };
    const parsed = ScenarioFileSchema.parse(input);
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0]!.description).toBe(brief);
  });

  it("accepts any free-string type (not a closed set)", () => {
    for (const type of ["ui", "api", "db", "cli", "grpc", "perf"]) {
      const input = {
        scenarios: [{ id: `S-${type}`, type, name: `${type} check`, description: brief }],
      };
      expect(() => ScenarioFileSchema.parse(input)).not.toThrow();
    }
  });

  it("rejects a missing description", () => {
    const input = { scenarios: [{ id: "S-001", type: "ui", name: "n" }] };
    expect(() => ScenarioFileSchema.parse(input)).toThrow();
  });

  it("rejects a description that is too short to be a brief", () => {
    const input = {
      scenarios: [{ id: "S-001", type: "ui", name: "n", description: "too short" }],
    };
    expect(() => ScenarioFileSchema.parse(input)).toThrow();
  });

  it("rejects an empty type", () => {
    const input = {
      scenarios: [{ id: "S-001", type: "", name: "n", description: brief }],
    };
    expect(() => ScenarioFileSchema.parse(input)).toThrow();
  });

  it("parses requirement and blast radius references", () => {
    const input = {
      scenarios: [
        {
          id: "S-001",
          type: "api",
          name: "GET /health returns 200",
          description: brief,
          requirementRefs: ["REQ-001"],
          blastRadiusRefs: ["BR-001"],
        },
      ],
    };
    const parsed = ScenarioFileSchema.parse(input);
    expect(parsed.scenarios[0]!.requirementRefs).toEqual(["REQ-001"]);
    expect(parsed.scenarios[0]!.blastRadiusRefs).toEqual(["BR-001"]);
  });

  it("rejects invalid requirement and blast radius references", () => {
    const input = {
      scenarios: [
        {
          id: "S-001",
          type: "api",
          name: "n",
          description: brief,
          requirementRefs: ["R-001"],
          blastRadiusRefs: ["blast-1"],
        },
      ],
    };
    expect(() => ScenarioFileSchema.parse(input)).toThrow();
  });

  it("rejects an empty scenarios array", () => {
    expect(() => ScenarioFileSchema.parse({ scenarios: [] })).toThrow();
  });

  it("rejects duplicate scenario ids", () => {
    const input = {
      scenarios: [
        { id: "dup", type: "api", name: "a", description: brief },
        { id: "dup", type: "ui", name: "b", description: brief },
      ],
    };
    expect(() => ScenarioFileSchema.parse(input)).toThrow(/duplicate/i);
  });
});
