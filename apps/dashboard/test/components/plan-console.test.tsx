import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentEvent, Artifact, PreflightStep, Run, Task } from "@pi-harness/shared";
import { PlanApprovalGate } from "@/components/plan/approval-gate";
import { PlanConsole } from "@/components/plan/plan-console";
import { buildLogRows } from "@/components/plan/plan-log-rows";
import { deriveKind } from "@/components/plan/preflight-progress";
import type { PlanJsonlEvent } from "@/lib/api";
import { PlanEventsProvider, usePlanEvents } from "@/lib/plan-events-context";

vi.mock("@/app/tasks/[id]/plan/actions", () => ({
  approvePlan: vi.fn(),
  requestPlanChanges: vi.fn(),
  restartPlan: vi.fn(),
}));

vi.mock("@/app/tasks/[id]/actions", () => ({
  cancelCurrentPhaseAction: vi.fn(),
}));

// ReactFlow needs real layout; in jsdom we render a lightweight stand-in that still
// drives the custom node components and the node-click handler so the execution graph
// is assertable.
vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  ReactFlow: ({
    nodes,
    nodeTypes,
    onNodeClick,
    children,
  }: {
    readonly nodes: ReadonlyArray<{ readonly id: string; readonly type?: string; readonly data: Record<string, unknown> }>;
    readonly nodeTypes: Record<string, ((props: { readonly data: Record<string, unknown> }) => React.ReactNode) | undefined>;
    readonly onNodeClick?: (event: unknown, node: { readonly id: string }) => void;
    readonly children: React.ReactNode;
  }) => (
    <div aria-label="execution graph">
      {nodes.map((node) => {
        const NodeComponent = node.type ? nodeTypes[node.type] : undefined;
        return (
          <div key={node.id} data-testid={`dag-node-${node.id}`} onClick={() => onNodeClick?.(null, node)}>
            {NodeComponent ? <NodeComponent data={node.data} /> : node.id}
          </div>
        );
      })}
      {children}
    </div>
  ),
}));

describe("PlanConsole", () => {
  it("renders the plan review command center from the plan bundle", () => {
    renderConsole({ gate: "awaiting_user" });

    expect(screen.getByRole("region", { name: "Plan review command center" })).toHaveTextContent(
      "Plan Review",
    );
    expect(screen.getByRole("region", { name: "Plan stage progress" })).toHaveTextContent(
      "Review",
    );
    expect(screen.queryByRole("region", { name: "Plan readiness" })).toBeNull();
    expect(screen.getByRole("region", { name: "Plan risks" })).toHaveTextContent(
      "Preflight blocked",
    );
    expect(screen.getByRole("region", { name: "Agents" })).toHaveTextContent(
      "codebase-scout",
    );
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Execution DAG" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
  });

  it("renders the plan review regions without workflow decision buttons while running", () => {
    renderConsole();

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Plan review command center" })).toBeInTheDocument();
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(agents).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Plan readiness" })).toBeNull();
    expect(screen.getByRole("region", { name: "Plan risks" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preflight agent navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Live preflight logs" })).toBeNull();
    expect(within(agents).getByRole("region", { name: "planner agent log" })).toBeInTheDocument();
    expect(within(agents).queryByText("Finding summary")).toBeNull();
    expect(screen.getByRole("region", { name: "Main artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Execution DAG" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it("shows done, live, queued, and blocked preflight agent states", () => {
    renderConsole();

    expect(screen.getByText("1 done · 1 live · 1 queued · 1 blocked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "codebase-scout agent log" })).toHaveTextContent("done");
    expect(screen.getByRole("button", { name: "integration-scanner agent log" })).toHaveTextContent("live");
    expect(screen.getByRole("button", { name: "claim-verifier agent log" })).toHaveTextContent("queued");
    expect(screen.getByRole("button", { name: "precedent-locator agent log" })).toHaveTextContent("blocked");
  });

  it("shows fallback preflight state from durable step data", () => {
    renderConsole({
      preflightSteps: [
        preflightStep({
          subagent: "integration-scanner",
          status: "fallback_succeeded",
          error: "preflight subagent integration-scanner timed out after 300000ms",
          fallbackReason: "preflight subagent integration-scanner timed out after 300000ms",
        }),
      ],
    });

    expect(screen.getByText(/1 fallback/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "integration-scanner agent log" })).toHaveTextContent("fallback");
    expect(screen.getByRole("button", { name: "integration-scanner agent log" })).toHaveTextContent("timed out");
  });

  it("shows phase cancel in the plan header and on active agents", () => {
    renderConsole();

    expect(screen.getByRole("button", { name: "Cancel plan" })).toBeInTheDocument();
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(within(agents).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("opens phase cancel confirmation from an active agent row", () => {
    renderConsole();

    const agents = screen.getByRole("region", { name: "Agents" });
    fireEvent.click(within(agents).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Cancel plan run" })).toBeInTheDocument();
    expect(screen.getByText(/All plan preflight agents/)).toBeInTheDocument();
  });

  it("opens the full agent drawer and switches timeline, findings, and raw JSONL tabs", () => {
    renderConsole();

    fireEvent.click(screen.getByRole("button", { name: "codebase-scout agent log" }));
    expect(screen.getByRole("dialog", { name: "codebase-scout full log" })).toBeInTheDocument();
    expect(screen.getAllByText(/No backend change needed/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    const drawer = screen.getByRole("dialog", { name: "codebase-scout full log" });
    expect(within(drawer).getByText("package.json")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Raw JSONL" }));
    expect(screen.getByText(/"kind": "tool_call"/)).toBeInTheDocument();
  });

  it("renders live SSE events whose timestamps are still serialized strings", () => {
    renderConsole({ liveEvents: serializedLiveEvents });

    fireEvent.click(screen.getByRole("button", { name: "codebase-scout agent log" }));
    fireEvent.click(screen.getByRole("button", { name: "Raw JSONL" }));

    expect(screen.getByText(/"ts": "2026-05-15T10:02:15.000Z"/)).toBeInTheDocument();
  });

  it("switches artifact tabs for plan, blast radius, scenarios, execution DAG, and raw source", () => {
    renderConsole();

    expect(screen.getByRole("article", { name: "plan.md rendered artifact" })).toHaveTextContent("Approach");

    fireEvent.click(screen.getByRole("tab", { name: "Blast Radius" }));
    expect(screen.getAllByText(/BR-001/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Scenarios" }));
    expect(screen.getAllByText(/task-detail-inspectors/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "Execution DAG" }));
    expect(screen.getByRole("article", { name: "Execution map" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));
    expect(screen.getAllByText(/C-001/).length).toBeGreaterThan(0);
    expect(screen.getByText("execution-dag.yaml")).toBeInTheDocument();
  });

  it("layers the execution dag the way the scheduler runs it", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("tab", { name: "Execution DAG" }));

    expect(screen.getByText("Execution map")).toBeInTheDocument();
    expect(screen.getByText("2 parallel")).toBeInTheDocument();
    expect(screen.getByText("1 exclusive")).toBeInTheDocument();
    // Every task renders as a node in the graph.
    expect(screen.getByText("Add DAG schema")).toBeInTheDocument();
    expect(screen.getByText("Update dashboard tests")).toBeInTheDocument();

    // Selecting a node opens the floating inspector with its dependency + assertion.
    fireEvent.click(screen.getByTestId("dag-node-C-002"));
    expect(screen.getByText(/waits for C-001/)).toBeInTheDocument();
    expect(screen.getByText(/phases render/)).toBeInTheDocument();
  });

  it("shows a stable empty state when execution-dag.yaml is missing", () => {
    renderConsole({ executionDag: null });
    fireEvent.click(screen.getByRole("tab", { name: "Execution DAG" }));

    expect(screen.getByText("execution phases not authored yet")).toBeInTheDocument();
  });

  it("groups phase plan documents under the plan overview", () => {
    renderConsole({
      phasePlans: [
        artifact("phase-plan", phasePlanBody, { phase: 1 }),
        artifact("phase-plan", phasePlanTwoBody, { phase: 2 }),
      ],
    });

    fireEvent.click(screen.getByRole("tab", { name: "Phase Plans" }));
    expect(screen.getByText("Phase 1")).toBeInTheDocument();
    expect(screen.getByText("plan-1.md")).toBeInTheDocument();
    expect(screen.getByText("Phase 2")).toBeInTheDocument();
    expect(screen.getByText("plan-2.md")).toBeInTheDocument();
  });

  it("renders the blocked banner with the failure reason when lastBlocked is set", () => {
    renderConsole({
      lastBlocked: {
        reason: "planner blocked by provider error",
        ts: "2026-05-21T18:58:41.000Z",
      },
    });

    const banner = screen.getByTestId("plan-blocked-banner");
    expect(banner).toHaveTextContent("plan blocked");
    expect(banner).toHaveTextContent("planner blocked by provider error");
  });

  it("surfaces a failed plan recovery summary before raw logs", () => {
    renderConsole({
      taskStatus: "plan_failed",
      runStatus: "failed",
      headerStatus: "failed - restart to retry",
      iconKind: "blocked",
      lastBlocked: {
        reason: "preflight agent failed to write findings",
        ts: "2026-05-21T18:58:41.000Z",
      },
    });

    const alert = screen.getByRole("alert", { name: "Plan recovery" });
    expect(alert).toHaveTextContent("Plan failed");
    expect(alert).toHaveTextContent("preflight agent failed to write findings");
    expect(within(alert).getByRole("button", { name: "Restart" })).toBeEnabled();
  });

  it("omits the blocked banner when lastBlocked is null", () => {
    renderConsole();
    expect(screen.queryByTestId("plan-blocked-banner")).toBeNull();
  });

  it("collapses and expands the planner log", () => {
    renderConsole();

    const toggle = screen.getByRole("button", { name: /planner log/i });
    expect(screen.getByText("planner hasn't called any tools yet")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("planner hasn't called any tools yet")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText("planner hasn't called any tools yet")).toBeInTheDocument();
  });

  it("groups adjacent message deltas into one assistant stream row", () => {
    const rows = buildLogRows([
      messageDelta("m1", "codebase-scout", "Let"),
      messageDelta("m2", "codebase-scout", " me"),
      messageDelta("m3", "codebase-scout", " read"),
      toolCall("t1", "codebase-scout", "read", { path: "package.json" }),
      messageDelta("m4", "codebase-scout", "Done"),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      verb: "msg",
      detail: "Let me read",
    });
    expect(rows[1]).toMatchObject({
      verb: "read",
      detail: "package.json",
    });
    expect(rows[2]).toMatchObject({
      verb: "msg",
      detail: "Done",
    });
  });

  it("summarizes structured failed tool output text in the compact log", () => {
    const rows = buildLogRows([
      toolResult("fail-1", "integration-scanner", "write_findings", false, {
        content: [
          {
            type: "text",
            text: "ENOSPC: no space left on device, open '/tmp/research/integration-scanner.md'",
          },
        ],
      }),
    ]);

    expect(rows[0]).toMatchObject({
      verb: "fail",
      detail: expect.stringContaining("ENOSPC"),
      tone: "blocked",
    });
  });

  it("derives preflight status from the latest attempt only", () => {
    const events: readonly PlanJsonlEvent[] = [
      planSystem("preflight_started", "attempt-old"),
      started("integration-scanner", "old-live", "attempt-old"),
      planSystem("preflight_started", "attempt-new"),
      started("integration-scanner", "new-done", "attempt-new"),
      ended("integration-scanner", "new-done", true, 1000, 0.01, "attempt-new"),
      started("integration-scanner", "old-orphan", "attempt-old"),
    ];

    expect(deriveKind("integration-scanner", { "integration-scanner": null }, events)).toBe("blocked");
  });
});

describe("PlanApprovalGate", () => {
  it("keeps approve and request-change actions in the existing phase gate", () => {
    render(<PlanApprovalGate taskId="T-1" gate="awaiting_user" taskStatus="planning" />);

    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeInTheDocument();
  });
});

describe("PlanEventsProvider", () => {
  it("hydrates terminal plan pages with persisted run events before SSE connects", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PlanEventsProvider
          runId={null}
          initialEvents={[
            toolCall("persisted-1", "integration-scanner", "write_findings", { body: "x" }),
          ]}
        >
          <PlanEventsProbe />
        </PlanEventsProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText("persisted-1")).toBeInTheDocument();
  });
});

function PlanEventsProbe() {
  const { events } = usePlanEvents();
  return <div>{events.map((event) => event.id).join(",")}</div>;
}

function renderConsole(
  opts: {
    readonly liveEvents?: readonly AgentEvent[];
    readonly executionDag?: Artifact | null;
    readonly phasePlans?: readonly Artifact[];
    readonly lastBlocked?: { reason: string; ts: string } | null;
    readonly preflightSteps?: readonly PreflightStep[];
    readonly taskStatus?: Task["status"];
    readonly runStatus?: Run["status"];
    readonly headerStatus?: string;
    readonly iconKind?: "intake" | "progress" | "review" | "done" | "blocked";
    readonly gate?: "running" | "awaiting_user";
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanEventsProvider runId={null}>
        <PlanConsole
          task={task(opts.taskStatus)}
          runs={[run(opts.runStatus)]}
          gate={opts.gate ?? "running"}
          headerStatus={opts.headerStatus ?? "in progress"}
          iconKind={opts.iconKind ?? "progress"}
          canCancelRun
          plan={artifact("plan", planBody)}
          phasePlans={opts.phasePlans ?? []}
          blastRadius={artifact("blast-radius", blastRadiusBody)}
          scenarios={artifact("scenarios", scenariosBody)}
          executionDag={
            opts.executionDag === undefined
              ? artifact("execution-dag", executionDagBody)
              : opts.executionDag
          }
          research={{
            "codebase-scout": "# Scout\n\nNo backend change needed.",
            "integration-scanner": null,
            "precedent-locator": null,
            "claim-verifier": null,
          }}
          planEvents={planEvents}
          preflightSteps={opts.preflightSteps ?? []}
          liveEvents={opts.liveEvents ?? liveEvents}
          connected={true}
          plannerLogDefaultOpen
          lastBlocked={opts.lastBlocked ?? null}
        />
      </PlanEventsProvider>
    </QueryClientProvider>,
  );
}

function preflightStep(
  patch: Partial<PreflightStep> & Pick<PreflightStep, "subagent" | "status">,
): PreflightStep {
  const { subagent, status, ...rest } = patch;
  return {
    taskId: "task-1",
    runId: "run-1",
    attemptId: "attempt-1",
    subagent,
    status,
    required: false,
    artifactPath: `/tmp/${subagent}.md`,
    startedAt: new Date("2026-05-12T20:00:00.000Z"),
    endedAt: new Date("2026-05-12T20:01:00.000Z"),
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    fallbackReason: null,
    ...rest,
  };
}

const planEvents: readonly PlanJsonlEvent[] = [
  started("codebase-scout", "s1"),
  ended("codebase-scout", "s1", true, 42_000, 0.031),
  started("integration-scanner", "s2"),
  started("precedent-locator", "s3"),
  ended("precedent-locator", "s3", true, 28_000, 0.019),
];

const liveEvents: readonly AgentEvent[] = [
  toolCall("1", "codebase-scout", "read", { path: "package.json" }),
  toolCall("2", "integration-scanner", "grep", { pattern: "PlanPage" }),
  log("3", "integration-scanner", "checking gate semantics"),
];

const serializedLiveEvents = JSON.parse(JSON.stringify(liveEvents)) as readonly AgentEvent[];

const planBody = `## Approach

Replace the task detail page with a focused command surface.

## Implementation steps

1. Add shell.
2. Add inspectors.
`;

const phasePlanBody = `# Phase 1: Foundation

## Objective
Build the shared foundation.
`;

const phasePlanTwoBody = `# Phase 2: Dashboard

## Objective
Render the new plan console.
`;

const scenariosBody = `scenarios:
  - id: task-detail-inspectors
    type: ui
    name: Inspectors open without mutation actions
`;

const blastRadiusBody = `items:
  - id: BR-001
    summary: Plan page shell and artifacts change together
`;

const executionDagBody = `version: 1
nodes:
  - id: C-001
    title: Add DAG schema
    phase: Foundation
    kind: schema
    lane: shared-types
    safety: exclusive
    dependsOn: []
    writes: [packages/shared/src/schemas/execution-dag.ts]
    reads: [packages/shared/src/schemas/artifacts.ts]
    verifies: [pnpm test]
    covers: [REQ-001]
    blastRadius: [BR-001]
    assertion: schema parses
  - id: C-002
    title: Render compact phases
    phase: Parallel Work
    kind: ui
    lane: dashboard
    safety: parallel-safe
    dependsOn: [C-001]
    writes: [apps/dashboard/components/plan/execution-phases-preview.tsx]
    reads: [apps/dashboard/components/plan/plan-artifact-console.tsx]
    verifies: [pnpm test]
    covers: [REQ-002]
    blastRadius: [BR-001]
    assertion: phases render
  - id: C-003
    title: Update dashboard tests
    phase: Parallel Work
    kind: test
    lane: dashboard-tests
    safety: parallel-safe
    dependsOn: [C-001]
    writes: [apps/dashboard/test/components/plan-console.test.tsx]
    reads: [apps/dashboard/components/plan/execution-phases-preview.tsx]
    verifies: [pnpm test]
    covers: [REQ-002]
    blastRadius: [BR-001]
    assertion: tests cover compact phases
`;

function task(status: Task["status"] = "planning"): Task {
  return {
    id: "T-1",
    title: "Redesign the tasks/:id page",
    description: "",
    status,
    priority: "high",
    worktreePath: "/tmp/T-1",
    branchName: "codex/task-detail-redesign",
    retryCount: 0,
    tags: [],
    phaseModels: {},
    workflow: "backend-feature",
    createdAt: new Date("2026-05-15T10:00:00Z"),
    updatedAt: new Date("2026-05-15T10:05:00Z"),
  };
}

function run(status: Run["status"] = "running"): Run {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    taskId: "T-1",
    phase: "plan",
    status,
    startedAt: new Date("2026-05-15T10:01:00Z"),
    endedAt: null,
    error: null,
    costUsd: 0.094,
    inputTokens: 1200,
    outputTokens: 500,
    piSessionPath: null,
  };
}

function artifact(
  kind: "plan" | "phase-plan" | "blast-radius" | "scenarios" | "execution-dag",
  body: string,
  opts: { readonly phase?: number } = {},
): Artifact {
  return {
    fm: {
      task: "T-1",
      kind,
      parent: kind === "plan" ? null : "plan.md",
      ...(opts.phase !== undefined ? { phase: opts.phase } : {}),
      status: "ready",
      branch: "codex/task-detail-redesign",
      last_updated: "2026-05-15T10:04:00Z",
      last_updated_by: "plan-agent",
    },
    body,
  };
}

function started(subagent: string, sessionId: string, attemptId?: string): PlanJsonlEvent {
  return {
    kind: "plan_subagent_started",
    ts: "2026-05-15T10:02:00.000Z",
    subagent,
    sessionId,
    ...(attemptId ? { attemptId } : {}),
  };
}

function ended(
  subagent: string,
  sessionId: string,
  ok: boolean,
  durationMs: number,
  costUsd: number,
  attemptId?: string,
): PlanJsonlEvent {
  return {
    kind: "plan_subagent_ended",
    ts: "2026-05-15T10:02:42.000Z",
    subagent,
    sessionId,
    ok,
    durationMs,
    costUsd,
    inputTokens: 100,
    outputTokens: 50,
    ...(attemptId ? { attemptId } : {}),
  };
}

function planSystem(systemKind: "preflight_started", attemptId: string): PlanJsonlEvent {
  return {
    kind: "plan_system",
    ts: "2026-05-15T10:01:00.000Z",
    systemKind,
    data: { attemptId },
  };
}

function toolCall(
  id: string,
  subagent: string,
  tool: string,
  input: unknown,
): AgentEvent {
  return {
    id,
    runId: "00000000-0000-4000-8000-000000000010",
    taskId: "T-1",
    ts: new Date("2026-05-15T10:02:15Z"),
    kind: "tool_call",
    tool,
    input,
    subagent,
  };
}

function log(id: string, subagent: string, text: string): AgentEvent {
  return {
    id,
    runId: "00000000-0000-4000-8000-000000000010",
    taskId: "T-1",
    ts: new Date("2026-05-15T10:02:18Z"),
    kind: "log",
    level: "info",
    text,
    subagent,
  };
}

function toolResult(
  id: string,
  subagent: string,
  tool: string,
  ok: boolean,
  output: unknown,
): AgentEvent {
  return {
    id,
    runId: "00000000-0000-4000-8000-000000000010",
    taskId: "T-1",
    ts: new Date("2026-05-15T10:02:18Z"),
    kind: "tool_result",
    callId: id,
    tool,
    ok,
    output,
    subagent,
  };
}

function messageDelta(id: string, subagent: string, text: string): AgentEvent {
  return {
    id,
    runId: "00000000-0000-4000-8000-000000000010",
    taskId: "T-1",
    ts: new Date("2026-05-15T10:02:15Z"),
    kind: "message_delta",
    text,
    subagent,
  };
}
