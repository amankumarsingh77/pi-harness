import { describe, it, expect } from "vitest";
import {
  parseExecutionDag,
  groupNodesByPhase,
  type ParsedDagNode,
} from "@/lib/code/parse-execution-dag";

const DAG_WITH_WAVES = `version: 1
nodes:
  - id: C-1
    title: Add code-state types
    phase: Scaffolding
    kind: types
    lane: core
    safety: parallel-safe
    dependsOn: []
    writes:
      - packages/shared/src/types/code.ts
    assertion: The CodeNodeState type compiles and is exported.
  - id: C-2
    title: Execution DAG schema
    phase: Scaffolding
    kind: schema
    lane: core
    safety: parallel-safe
    dependsOn: []
    assertion: ExecutionDagSchema validates a sample DAG.
  - id: C-5
    title: runCode node loop
    phase: Runner
    kind: runner
    lane: runner
    safety: exclusive
    dependsOn: [C-1, C-2]
    assertion: runCode drives the DAG to terminal.
waves:
  - id: W-1
    name: Scaffolding
    policy: parallel
    nodes: [C-1, C-2]
  - id: W-2
    name: Runner
    policy: sequential
    nodes:
      - C-5
`;

const DAG_NO_WAVES = `version: 1
nodes:
  - id: C-1
    title: First
    phase: Foundation
    safety: parallel-safe
    dependsOn: []
  - id: C-2
    title: Second
    phase: Foundation
    safety: parallel-safe
    dependsOn: []
  - id: C-3
    title: Third
    phase: Wiring
    safety: exclusive
    dependsOn: [C-1]
`;

describe("parseExecutionDag", () => {
  it("parses node scalars, dependsOn, and assertion", () => {
    const dag = parseExecutionDag(DAG_WITH_WAVES);
    expect(dag.nodes).toHaveLength(3);
    const first = dag.nodes[0];
    expect(first).toMatchObject({
      id: "C-1",
      title: "Add code-state types",
      phase: "Scaffolding",
      kind: "types",
      lane: "core",
      safety: "parallel-safe",
      dependsOn: [],
      assertion: "The CodeNodeState type compiles and is exported.",
    });
    expect(dag.nodes[2]).toMatchObject({
      id: "C-5",
      safety: "exclusive",
      dependsOn: ["C-1", "C-2"],
    });
  });

  it("parses an explicit waves block (inline and block node lists)", () => {
    const dag = parseExecutionDag(DAG_WITH_WAVES);
    expect(dag.waves).toEqual([
      { id: "W-1", name: "Scaffolding", policy: "parallel", nodes: ["C-1", "C-2"] },
      { id: "W-2", name: "Runner", policy: "sequential", nodes: ["C-5"] },
    ]);
  });

  it("returns no waves when the block is absent", () => {
    const dag = parseExecutionDag(DAG_NO_WAVES);
    expect(dag.nodes).toHaveLength(3);
    expect(dag.waves).toEqual([]);
  });

  it("does not mistake node id/name fields for wave fields", () => {
    const dag = parseExecutionDag(DAG_NO_WAVES);
    expect(dag.waves).toEqual([]);
    expect(dag.nodes.map((n) => n.id)).toEqual(["C-1", "C-2", "C-3"]);
  });

  it("returns empty nodes and waves for an empty body", () => {
    expect(parseExecutionDag("")).toEqual({ nodes: [], waves: [] });
  });
});

describe("groupNodesByPhase", () => {
  const nodes: readonly ParsedDagNode[] = parseExecutionDag(DAG_NO_WAVES).nodes;

  it("groups nodes by phase preserving first-seen order", () => {
    const groups = groupNodesByPhase(nodes);
    expect(groups.map((g) => g.name)).toEqual(["Foundation", "Wiring"]);
    expect(groups[0]?.nodes.map((n) => n.id)).toEqual(["C-1", "C-2"]);
  });

  it("infers parallel policy only when all nodes are parallel-safe", () => {
    const groups = groupNodesByPhase(nodes);
    expect(groups[0]?.policy).toBe("parallel");
    expect(groups[1]?.policy).toBe("sequential");
  });
});
