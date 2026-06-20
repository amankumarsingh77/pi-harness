import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentEvent, Artifact, PlanAgentGraph, PlanAgentGraphNode, Run, Task } from "@pi-harness/shared";
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

// Shiki is async + heavy; mock it so CodeBlock highlighting resolves synchronously to a
// deterministic, escaped string in tests.
vi.mock("@/lib/shiki", () => ({
  normalizeLang: (lang: string) => lang,
  highlightToHtml: (code: string) =>
    Promise.resolve(`<pre class="shiki"><code>${code.replace(/</g, "&lt;")}</code></pre>`),
}));

vi.mock("@xyflow/react", () => ({
  Background: () => <div data-testid="flow-background" />,
  Controls: () => <div data-testid="flow-controls" />,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom" },
  ReactFlow: ({
    nodes,
    edges,
    nodeTypes,
    children,
  }: {
    readonly nodes: ReadonlyArray<{
      readonly id: string;
      readonly type?: string;
      readonly data: { readonly graphNode: PlanAgentGraphNode };
    }>;
    readonly edges: ReadonlyArray<{
      readonly id: string;
      readonly animated?: boolean;
      readonly style?: {
        readonly stroke?: string;
        readonly strokeWidth?: number;
      };
    }>;
    readonly nodeTypes: Record<string, ((props: { readonly data: { readonly graphNode: PlanAgentGraphNode } }) => ReactNode) | undefined>;
    readonly children: ReactNode;
  }) => {
    return (
      <div aria-label="mock plan graph">
        {nodes.map((node) => {
          const NodeComponent = node.type ? nodeTypes[node.type] : undefined;
          return (
            <div key={node.id} data-testid={`flow-node-${node.id}`}>
              {NodeComponent ? <NodeComponent data={node.data} /> : node.data.graphNode.title}
            </div>
          );
        })}
        {edges.map((edge) => (
          <div
            key={edge.id}
            data-testid={`flow-edge-${edge.id}`}
            data-animated={String(edge.animated ?? false)}
            data-stroke={edge.style?.stroke ?? ""}
          />
        ))}
        {children}
      </div>
    );
  },
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

  it("keeps connections blue while status is shown on node borders", () => {
    renderCanvas({ agentGraph: graphWithDoneAgent });

    const runningEdge = screen.getByTestId("flow-edge-planner->agent-1:spawn");
    const doneEdge = screen.getByTestId("flow-edge-planner->agent-2:spawn");
    expect(runningEdge).toHaveAttribute("data-stroke", "rgba(94,106,210,0.82)");
    expect(doneEdge).toHaveAttribute("data-stroke", "rgba(94,106,210,0.82)");
    expect(runningEdge).toHaveAttribute("data-animated", "false");
    expect(doneEdge).toHaveAttribute("data-animated", "false");

    expect(screen.getByTestId("flow-node-agent-1").firstElementChild).toHaveClass(
      "plan-agent-node-running",
    );
    expect(screen.getByTestId("flow-node-agent-2").firstElementChild).toHaveClass(
      "plan-agent-node-done",
    );
  });

  it("keeps restart enabled for failed plan runs", () => {
    renderCanvas({
      taskStatus: "plan_failed",
      runStatus: "failed",
    });

    expect(screen.getByRole("button", { name: "Restart" })).toBeEnabled();
  });

  it("keeps agent details out of the default page until an agent is opened", () => {
    renderCanvas();

    expect(screen.queryByRole("dialog", { name: /agent dossier/i })).toBeNull();
    expect(screen.queryByText("agent info")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));

    expect(screen.getByRole("dialog", { name: /agent dossier/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scout codebase" })).toBeInTheDocument();
  });

  it("opens generated planning artifacts from a header action", () => {
    renderCanvas();

    fireEvent.click(screen.getByRole("button", { name: /Artifacts 2/ }));

    const dialog = screen.getByRole("dialog", { name: /planning artifacts/i });
    expect(within(dialog).getByRole("heading", { name: "Planning artifacts" })).toBeInTheDocument();
    const artifactFiles = within(dialog).getByRole("navigation", { name: /artifact files/i });
    expect(within(artifactFiles).getByRole("tab", { name: /plan.md/ })).toHaveAttribute("aria-selected", "true");
    expect(within(artifactFiles).getByRole("tab", { name: /execution-dag.yaml/ })).toBeInTheDocument();
    // Document header for the selected file: filename + copy utility + rendered heading.
    expect(within(dialog).getByRole("button", { name: /copy document/i })).toBeInTheDocument();
    expect(within(dialog).getByText("Plan")).toBeInTheDocument();
  });

  it("renders artifact code fences through a labelled, copyable code block", async () => {
    renderCanvas({
      plan: artifact(
        "plan",
        "## Phase DAG\n\n```dot\ndigraph { A -> B; }\n```\n",
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: /Artifacts 2/ }));

    const dialog = screen.getByRole("dialog", { name: /planning artifacts/i });
    // Fence language label is shown, and the block exposes a copy affordance.
    expect(within(dialog).getByText("dot")).toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: /copy code/i })).toBeInTheDocument();
  });

  it("renders yaml artifacts through the highlighted code block, not a raw pre", () => {
    renderCanvas();

    fireEvent.click(screen.getByRole("button", { name: /Artifacts 2/ }));
    fireEvent.click(screen.getByRole("tab", { name: /scenarios.yaml/ }));

    const dialog = screen.getByRole("dialog", { name: /planning artifacts/i });
    expect(within(dialog).getByText("yaml")).toBeInTheDocument();
  });

  it("toggles a markdown artifact between rendered and raw source", () => {
    renderCanvas();

    fireEvent.click(screen.getByRole("button", { name: /Artifacts 2/ }));

    const dialog = screen.getByRole("dialog", { name: /planning artifacts/i });
    const rawToggle = within(dialog).getByRole("button", { name: "Raw" });
    fireEvent.click(rawToggle);

    expect(within(dialog).getByRole("button", { name: "Rendered" })).toBeInTheDocument();
  });

  it("shows missing artifact states inside the artifact workspace", () => {
    renderCanvas();

    fireEvent.click(screen.getByRole("button", { name: /Artifacts 2/ }));
    fireEvent.click(screen.getByRole("tab", { name: /execution-dag.yaml/ }));

    expect(screen.getByText("execution-dag.yaml has not been generated yet")).toBeInTheDocument();
  });

  it("hides scrollbars in expanded live log details", () => {
    renderCanvas({
      liveEvents: [
        event({ id: "call-1", kind: "tool_call", tool: "read", input: { path: "package.json" }, subagent: "agent-1" }),
        event({ id: "result-1", kind: "tool_result", tool: "read", ok: true, output: "done", subagent: "agent-1" }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));
    fireEvent.click(screen.getByRole("tab", { name: "logs" }));
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
    fireEvent.click(screen.getByRole("tab", { name: "findings" }));

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

  it("populates running agent overview with assignment and execution metadata", () => {
    renderCanvas();

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));

    expect(screen.getByText("assignment")).toBeInTheDocument();
    expect(screen.getByText("role")).toBeInTheDocument();
    expect(screen.getAllByText("codebase-scout").length).toBeGreaterThan(0);
    expect(screen.getByText("lane")).toBeInTheDocument();
    expect(screen.getAllByText("research").length).toBeGreaterThan(0);
    expect(screen.getByText("depends on")).toBeInTheDocument();
    expect(screen.getAllByText("planner").length).toBeGreaterThan(0);
    expect(screen.getByText("execution")).toBeInTheDocument();
    expect(screen.getByText("crofai/kimi-k2.6")).toBeInTheDocument();
    expect(screen.getByText("session-1")).toBeInTheDocument();
    expect(screen.getAllByText("tools").length).toBeGreaterThan(0);
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.queryByText(/Find the relevant files\./)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "prompt" }));

    expect(screen.getByText("prompt sent")).toBeInTheDocument();
    expect(screen.getByText(/Find the relevant files\./)).toBeInTheDocument();
  });

  it("gates the revision Send button behind a minimum-length comment", () => {
    renderCanvas({ gate: "awaiting_user" });

    fireEvent.click(screen.getByRole("button", { name: /Request changes/ }));

    const send = screen.getByRole("button", { name: /Send revision/ });
    expect(send).toBeDisabled();
    expect(screen.getByText(/more chars? to send/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("What should change?"), {
      target: { value: "tighten the error handling here" },
    });

    expect(send).toBeEnabled();
    expect(screen.queryByText(/more chars? to send/)).toBeNull();
    expect(screen.getByText("⌘↵ to send")).toBeInTheDocument();
  });

  it("shows a pending label on Approve while the action is in flight", async () => {
    const { approvePlan } = await import("@/app/tasks/[id]/plan/actions");
    let resolveApprove: () => void = () => {};
    vi.mocked(approvePlan).mockImplementation(
      () => new Promise<void>((resolve) => { resolveApprove = resolve; }),
    );

    renderCanvas({ gate: "awaiting_user" });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("button", { name: /Approving/ })).toBeInTheDocument();

    await act(async () => {
      resolveApprove();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("marks live agent metrics with a pulsing affordance while running", () => {
    renderCanvas();

    fireEvent.click(screen.getByRole("button", { name: /Scout codebase/ }));

    const costTile = screen.getByText("cost so far").closest("div");
    expect(costTile?.querySelector(".pulse-dot")).not.toBeNull();
  });
});

function renderCanvas(
  opts: {
    readonly liveEvents?: readonly AgentEvent[];
    readonly planEvents?: readonly PlanJsonlEvent[];
    readonly agentGraph?: PlanAgentGraph;
    readonly taskStatus?: Task["status"];
    readonly runStatus?: Run["status"];
    readonly gate?: "running" | "awaiting_user";
    readonly plan?: Artifact | null;
  } = {},
) {
  return render(
    <PlanCanvasConsole
      task={{ ...task, status: opts.taskStatus ?? task.status }}
      runs={[{ ...run, status: opts.runStatus ?? run.status }]}
      gate={opts.gate ?? "running"}
      headerStatus="in progress"
      iconKind="progress"
      canCancelRun={false}
      plan={opts.plan !== undefined ? opts.plan : artifact("plan", "## Plan")}
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
      prompt: null,
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
      prompt: [
        "You are a dynamically spawned plan child agent for task T-1.",
        "Node id: agent-1.",
        "Return findings directly to the parent planner with return_findings. Do not write a findings artifact.",
        "",
        "# Scoped assignment",
        "",
        "Find the relevant files.",
      ].join("\n"),
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
      prompt: null,
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
      prompt: null,
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

const doneAgentNode: PlanAgentGraphNode = {
  id: "agent-2",
  kind: "agent",
  title: "Audit workflow",
  role: "workflow-auditor",
  lane: "research",
  status: "succeeded",
  parentId: "planner",
  sessionId: "session-2",
  model: "crofai/kimi-k2.6",
  tools: ["read"],
  prompt: "Audit the workflow selector implementation.",
  artifactPath: ".harness/T-1/research/agent-2.md",
  dependsOn: ["planner"],
  startedAt: "2026-06-06T00:00:00.000Z",
  endedAt: "2026-06-06T00:01:00.000Z",
  durationMs: 60_000,
  costUsd: 0.01,
  inputTokens: 500,
  outputTokens: 125,
  error: null,
};

const graphWithDoneAgent: PlanAgentGraph = {
  ...agentGraph,
  nodes: [...agentGraph.nodes, doneAgentNode],
  edges: [
    ...agentGraph.edges,
    { id: "planner->agent-2:spawn", source: "planner", target: "agent-2", kind: "spawn" },
  ],
};
