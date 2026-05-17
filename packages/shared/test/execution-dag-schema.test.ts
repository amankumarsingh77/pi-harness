import { describe, expect, it } from "vitest";
import { ExecutionDagSchema } from "../src/schemas/execution-dag.js";

const validDag = {
  version: 1,
  nodes: [
    {
      id: "C-001",
      title: "Add shared execution DAG schema",
      phase: "Foundation",
      kind: "schema",
      lane: "shared-types",
      safety: "exclusive",
      dependsOn: [],
      writes: ["packages/shared/src/schemas/execution-dag.ts"],
      reads: ["packages/shared/src/schemas/artifacts.ts"],
      verifies: ["pnpm --filter @pi-harness/shared test"],
      covers: ["REQ-001"],
      blastRadius: ["BR-001"],
      assertion: "ExecutionDagSchema rejects invalid DAGs.",
    },
    {
      id: "C-002",
      title: "Render compact execution phases",
      phase: "Plan UI",
      kind: "ui",
      lane: "dashboard",
      safety: "parallel-safe",
      dependsOn: ["C-001"],
      writes: ["apps/dashboard/components/plan/execution-phases-preview.tsx"],
      reads: ["packages/shared/src/schemas/execution-dag.ts"],
      verifies: ["pnpm --filter @pi-harness/dashboard test"],
      covers: ["REQ-002"],
      blastRadius: ["BR-002"],
      assertion: "The plan page renders DAG phases without raw YAML.",
    },
  ],
  waves: [
    {
      id: "W-001",
      name: "Foundation",
      policy: "sequential",
      nodes: ["C-001"],
    },
    {
      id: "W-002",
      name: "Plan UI",
      policy: "parallel",
      nodes: ["C-002"],
    },
  ],
};

describe("ExecutionDagSchema", () => {
  it("parses a valid execution DAG", () => {
    const parsed = ExecutionDagSchema.parse(validDag);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[1]!.dependsOn).toEqual(["C-001"]);
  });

  it("rejects duplicate node ids", () => {
    expect(() =>
      ExecutionDagSchema.parse({
        ...validDag,
        nodes: [validDag.nodes[0], validDag.nodes[0]],
      }),
    ).toThrow(/duplicate/i);
  });

  it("rejects missing dependency refs", () => {
    expect(() =>
      ExecutionDagSchema.parse({
        ...validDag,
        nodes: [
          validDag.nodes[0],
          {
            ...validDag.nodes[1],
            dependsOn: ["C-404"],
          },
        ],
      }),
    ).toThrow(/unknown dependency/i);
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      ExecutionDagSchema.parse({
        ...validDag,
        nodes: [
          {
            ...validDag.nodes[0],
            dependsOn: ["C-002"],
          },
          validDag.nodes[1],
        ],
      }),
    ).toThrow(/cycle/i);
  });

  it("rejects nodes without write ownership", () => {
    expect(() =>
      ExecutionDagSchema.parse({
        ...validDag,
        nodes: [
          {
            ...validDag.nodes[0],
            writes: [],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects waves that reference unknown nodes", () => {
    expect(() =>
      ExecutionDagSchema.parse({
        ...validDag,
        waves: [
          {
            id: "W-404",
            name: "Broken",
            policy: "parallel",
            nodes: ["C-404"],
          },
        ],
      }),
    ).toThrow(/unknown wave node/i);
  });
});
