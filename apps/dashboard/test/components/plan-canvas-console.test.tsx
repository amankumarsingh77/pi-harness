import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentEvent, Artifact, PlanAgentGraph, Run, Task } from "@pi-harness/shared";
import { PlanCanvasConsole } from "@/components/plan/plan-canvas-console";
import type { PlanJsonlEvent } from "@/lib/api";

vi.mock("@/app/tasks/[id]/plan/actions", () => ({
  approvePlan: vi.fn(),
  requestPlanChanges: vi.fn(),
  restartPlan: vi.fn(),
}));

vi.mock("@/app/tasks/[id]/actions", () => ({
  cancelCurrentPhaseAction: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
  Background: () => <div data-testid="flow-background" />,
  Controls: () => <div data-testid="flow-controls" />,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
  ReactFlow: ({
    nodes,
    edges,
    children,
  }: {
    readonly nodes: ReadonlyArray<{ readonly id: string; readonly data: { readonly graphNode: { readonly title: string } } }>;
    readonly edges: ReadonlyArray<{ readonly id: string }>;
    readonly children: React.ReactNode;
  }) => (
    <div aria-label="mock plan graph">
      {nodes.map((node) => (
        <div key={node.id} data-testid={`flow-node-${node.id}`}>
          {node.data.graphNode.title}
        </div>
      ))}
      {edges.map((edge) => (
        <div key={edge.id} data-testid={`flow-edge-${edge.id}`} />
      ))}
      {children}
    </div>
  ),
}));

describe("PlanCanvasConsole", () => {
  it("renders only planner and agent nodes on the canvas", () => {
    renderCanvas();

    const graph = screen.getByLabelText("mock plan graph");
    expect(within(graph).getByText("Planner Orchestrator")).toBeInTheDocument();
    expect(within(graph).getByText("Scout codebase")).toBeInTheDocument();
    expect(within(graph).queryByText("plan.md")).toBeNull();
    expect(within(graph).queryByText("scenarios.yaml")).toBeNull();
  });

  it("keeps restart enabled for failed plan runs", () => {
    renderCanvas({
      taskStatus: "plan_failed",
      runStatus: "failed",
    });

    expect(screen.getByRole("button", { name: "Restart" })).toBeEnabled();
  });

  it("hides scrollbars in expanded live log details", () => {
    renderCanvas({
      liveEvents: [
        event({ id: "call-1", kind: "tool_call", tool: "read", input: { path: "package.json" }, subagent: "agent-1" }),
        event({ id: "result-1", kind: "tool_result", tool: "read", ok: true, output: "done", subagent: "agent-1" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));
    fireEvent.click(screen.getByRole("button", { name: "logs" }));
    fireEvent.click(screen.getByRole("button", { name: /read package.json/ }));

    expect(screen.getByTestId("expanded-log-details")).toHaveClass("scroll-hide");
  });

  it("renders returned dynamic child findings without a node artifact path", () => {
    renderCanvas({
      agentGraph: {
        ...agentGraph,
        nodes: agentGraph.nodes.map((node) =>
          node.id === "agent-1" ? { ...node, artifactPath: null } : node,
        ),
      },
      planEvents: [
        {
          kind: "plan_agent_node_findings",
          ts: "2026-06-06T00:00:05.000Z",
          nodeId: "agent-1",
          body: "# Findings\n\nPattern: apps/orchestrator/src/agents/plan.ts:152",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));
    fireEvent.click(screen.getByRole("button", { name: "artifacts" }));

    expect(screen.getByText("returned findings")).toBeInTheDocument();
    expect(screen.getByText(/Pattern: apps\/orchestrator\/src\/agents\/plan\.ts:152/)).toBeInTheDocument();
    expect(screen.queryByText("node artifact")).toBeNull();
  });

  it("labels running node usage as so far in the overview", () => {
    renderCanvas({
      agentGraph: {
        ...agentGraph,
        nodes: agentGraph.nodes.map((node) =>
          node.id === "agent-1"
            ? { ...node, costUsd: 0.025, inputTokens: 1250, outputTokens: 320 }
            : node,
        ),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));

    expect(screen.getByText("cost so far")).toBeInTheDocument();
    expect(screen.getByText("$0.0250")).toBeInTheDocument();
    expect(screen.getByText("tokens in so far")).toBeInTheDocument();
    expect(screen.getByText("1,250")).toBeInTheDocument();
  });
});

function renderCanvas(
  opts: {
    readonly liveEvents?: readonly AgentEvent[];
    readonly planEvents?: readonly PlanJsonlEvent[];
    readonly agentGraph?: PlanAgentGraph;
    readonly taskStatus?: Task["status"];
    readonly runStatus?: Run["status"];
  } = {},
) {
  return render(
    <PlanCanvasConsole
      task={{ ...task, status: opts.taskStatus ?? task.status }}
      runs={[{ ...run, status: opts.runStatus ?? run.status }]}
      gate="running"
      headerStatus="in progress"
      iconKind="progress"
      canCancelRun={false}
      plan={artifact("plan", "## Plan")}
      phasePlans={[]}
      blastRadius={null}
      scenarios={artifact("scenarios", "scenarios: []")}
      executionDag={null}
      agentGraph={opts.agentGraph ?? agentGraph}
      planEvents={opts.planEvents ?? []}
      liveEvents={opts.liveEvents ?? []}
      connected={true}
      lastBlocked={null}
    />,
  );
}

function artifact(kind: Artifact["fm"]["kind"], body: string): Artifact {
  return {
    fm: {
      task: "T-1",
      kind,
      parent: null,
      status: "ready",
      branch: "pi/T-1",
      last_updated: "2026-06-06T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body,
  };
}

function event(
  patch:
    | Pick<Extract<AgentEvent, { kind: "tool_call" }>, "id" | "kind" | "tool" | "input" | "subagent">
    | Pick<Extract<AgentEvent, { kind: "tool_result" }>, "id" | "kind" | "tool" | "ok" | "output" | "subagent">,
): AgentEvent {
  return {
    runId: "run-1",
    taskId: "T-1",
    ts: new Date("2026-06-06T00:00:00.000Z"),
    ...patch,
  };
}

const task: Task = {
  id: "T-1",
  title: "Dynamic planner",
  description: "Implement dynamic planner canvas",
  status: "planning",
  workflow: "backend-feature",
  worktreePath: "/tmp/pi/T-1",
  branchName: "pi/T-1",
  retryCount: 0,
  priority: "medium",
  tags: [],
  phaseModels: {},
  createdAt: new Date("2026-06-06T00:00:00.000Z"),
  updatedAt: new Date("2026-06-06T00:00:00.000Z"),
};

const run: Run = {
  id: "run-1",
  taskId: "T-1",
  phase: "plan",
  status: "running",
  startedAt: new Date("2026-06-06T00:00:00.000Z"),
  endedAt: null,
  error: null,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  piSessionPath: null,
};

const agentGraph: PlanAgentGraph = {
  totals: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
  nodes: [
    {
      id: "planner",
      kind: "planner",
      title: "Planner Orchestrator",
      role: "planner",
      lane: "control",
      status: "running",
      parentId: null,
      sessionId: null,
      model: null,
      tools: [],
      artifactPath: null,
      dependsOn: [],
      startedAt: null,
      endedAt: null,
      durationMs: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
    },
    {
      id: "agent-1",
      kind: "agent",
      title: "Scout codebase",
      role: "codebase-scout",
      lane: "research",
      status: "running",
      parentId: "planner",
      sessionId: "session-1",
      model: "crofai/kimi-k2.6",
      tools: ["read"],
      artifactPath: ".harness/T-1/research/agent-1.md",
      dependsOn: ["planner"],
      startedAt: "2026-06-06T00:00:00.000Z",
      endedAt: null,
      durationMs: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
    },
    {
      id: "artifact:plan.md",
      kind: "artifact",
      title: "plan.md",
      role: "artifact",
      lane: "files",
      status: "artifact",
      parentId: "planner",
      sessionId: null,
      model: null,
      tools: [],
      artifactPath: null,
      dependsOn: [],
      startedAt: null,
      endedAt: null,
      durationMs: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
    },
    {
      id: "artifact:scenarios.yaml",
      kind: "artifact",
      title: "scenarios.yaml",
      role: "artifact",
      lane: "files",
      status: "artifact",
      parentId: "planner",
      sessionId: null,
      model: null,
      tools: [],
      artifactPath: null,
      dependsOn: [],
      startedAt: null,
      endedAt: null,
      durationMs: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: null,
    },
  ],
  edges: [
    { id: "planner->agent-1:spawn", source: "planner", target: "agent-1", kind: "spawn" },
    { id: "planner->artifact:plan.md:artifact", source: "planner", target: "artifact:plan.md", kind: "artifact" },
    { id: "planner->artifact:scenarios.yaml:artifact", source: "planner", target: "artifact:scenarios.yaml", kind: "artifact" },
  ],
};
