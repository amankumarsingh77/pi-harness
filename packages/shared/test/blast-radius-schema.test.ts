import { describe, expect, it } from "vitest";
import { BlastRadiusFileSchema } from "../src/schemas/blast-radius.js";

const validBlastRadius = {
  items: [
    {
      id: "BR-001",
      requirementRefs: ["REQ-001"],
      surface: "api",
      title: "Plan bundle route returns blast radius",
      risk: "medium",
      touchpoints: [
        {
          path: "apps/orchestrator/src/http/routes/plan.ts",
          role: "change",
          note: "Plan bundle includes the committed blast-radius artifact.",
        },
      ],
      inbound: ["dashboard plan page"],
      outbound: ["artifact store"],
      precedentRefs: [],
      verificationRefs: ["plan-bundle-includes-blast-radius"],
    },
  ],
};

describe("BlastRadiusFileSchema", () => {
  it("parses a valid blast radius file", () => {
    const parsed = BlastRadiusFileSchema.parse(validBlastRadius);

    expect(parsed.items[0]!.id).toBe("BR-001");
  });

  it("rejects an empty items list", () => {
    expect(() => BlastRadiusFileSchema.parse({ items: [] })).toThrow();
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      BlastRadiusFileSchema.parse({
        items: [validBlastRadius.items[0], validBlastRadius.items[0]],
      }),
    ).toThrow(/duplicate/i);
  });

  it("rejects invalid requirement and blast radius refs", () => {
    expect(() =>
      BlastRadiusFileSchema.parse({
        items: [
          {
            ...validBlastRadius.items[0],
            id: "blast-001",
            requirementRefs: ["R-001"],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects invalid risk and surface values", () => {
    expect(() =>
      BlastRadiusFileSchema.parse({
        items: [
          {
            ...validBlastRadius.items[0],
            surface: "cli",
            risk: "urgent",
          },
        ],
      }),
    ).toThrow();
  });
});
