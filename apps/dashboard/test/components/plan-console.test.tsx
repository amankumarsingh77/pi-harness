import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentEvent, Artifact, Run, Task } from "@pi-harness/shared";
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

describe("PlanConsole", () => {
  it("renders the raw plan console regions without workflow decision buttons", () => {
    renderConsole();

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByText("plan phase")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preflight agent navigation" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Live preflight logs" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Main artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "planner agent log" })).toBeInTheDocument();
    expect(screen.getAllByText("plan.md").length).toBeGreaterThan(0);
    expect(screen.getAllByText("blast-radius.yaml").length).toBeGreaterThan(0);
    expect(screen.getAllByText("scenarios.yaml").length).toBeGreaterThan(0);
    expect(screen.getByText("execution phases")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it("shows done, live, queued, and blocked preflight agent states", () => {
    renderConsole();

    expect(screen.getByText("1 done · 1 live · 1 queued · 1 blocked")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "codebase-scout preflight agent" })).toHaveTextContent("done");
    expect(screen.getByRole("article", { name: "integration-scanner preflight agent" })).toHaveTextContent("live");
    expect(screen.getByRole("article", { name: "claim-verifier preflight agent" })).toHaveTextContent("queued");
    expect(screen.getByRole("article", { name: "precedent-locator preflight agent" })).toHaveTextContent("blocked");
  });

  it("shows phase cancel in the plan header and on active preflight agents", () => {
    renderConsole();

    expect(screen.getByRole("button", { name: "Cancel plan" })).toBeInTheDocument();
    const integrationPane = screen.getByRole("article", {
      name: "integration-scanner preflight agent",
    });
    expect(within(integrationPane).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    const scoutPane = screen.getByRole("article", { name: "codebase-scout preflight agent" });
    expect(within(scoutPane).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("opens phase cancel confirmation from an active preflight card", () => {
    renderConsole();

    const integrationPane = screen.getByRole("article", {
      name: "integration-scanner preflight agent",
    });
    fireEvent.click(within(integrationPane).getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Cancel plan run" })).toBeInTheDocument();
    expect(screen.getByText(/All plan preflight agents/)).toBeInTheDocument();
  });

  it("opens the full agent drawer and switches timeline, findings, and raw JSONL tabs", () => {
    renderConsole();

    fireEvent.click(screen.getAllByRole("button", { name: "Full log" })[0]!);
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

    expect(screen.getByRole("article", { name: "codebase-scout preflight agent" })).toHaveTextContent("package.json");
    fireEvent.click(screen.getAllByRole("button", { name: "Full log" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Raw JSONL" }));

    expect(screen.getByText(/"ts": "2026-05-15T10:02:15.000Z"/)).toBeInTheDocument();
  });

  it("opens expanded artifact modals for plan, blast radius, scenarios, and execution DAG", () => {
    renderConsole();

    const mainArtifacts = screen.getByRole("region", { name: "Main artifacts" });
    const expandButtons = within(mainArtifacts).getAllByRole("button", { name: "Expand" });

    fireEvent.click(expandButtons[0]!);
    expect(screen.getByRole("dialog", { name: "plan.md expanded artifact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rendered" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Raw source" }));
    expect(screen.getByText(/## Approach/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close artifact modal" }));

    fireEvent.click(expandButtons[1]!);
    expect(screen.getByRole("dialog", { name: "blast-radius.yaml expanded artifact" })).toBeInTheDocument();
    expect(screen.getAllByText(/BR-001/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Close artifact modal" }));

    fireEvent.click(expandButtons[2]!);
    expect(screen.getByRole("dialog", { name: "scenarios.yaml expanded artifact" })).toBeInTheDocument();
    expect(screen.getAllByText(/task-detail-inspectors/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Close artifact modal" }));

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByRole("dialog", { name: "execution-dag.yaml expanded artifact" })).toBeInTheDocument();
    expect(screen.getAllByText(/C-001/).length).toBeGreaterThan(0);
  });

  it("renders compact execution phase rows from execution-dag.yaml", () => {
    renderConsole();

    expect(screen.getByText("Foundation")).toBeInTheDocument();
    expect(screen.getByText("Parallel Work")).toBeInTheDocument();
    expect(screen.getByText("can run together")).toBeInTheDocument();
    expect(screen.getByText("C-001")).toBeInTheDocument();
    expect(screen.getByText("C-002")).toBeInTheDocument();
  });

  it("shows a stable empty state when execution-dag.yaml is missing", () => {
    renderConsole({ executionDag: null });

    expect(screen.getByText("execution phases not authored yet")).toBeInTheDocument();
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
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanEventsProvider runId={null}>
        <PlanConsole
          task={task()}
          runs={[run()]}
          gate="running"
          headerStatus="in progress"
          iconKind="progress"
          canCancelRun
          plan={artifact("plan", planBody)}
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
          liveEvents={opts.liveEvents ?? liveEvents}
          connected={true}
          plannerLogDefaultOpen
        />
      </PlanEventsProvider>
    </QueryClientProvider>,
  );
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

function task(): Task {
  return {
    id: "T-1",
    title: "Redesign the tasks/:id page",
    description: "",
    status: "planning",
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

function run(): Run {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    taskId: "T-1",
    phase: "plan",
    status: "running",
    startedAt: new Date("2026-05-15T10:01:00Z"),
    endedAt: null,
    error: null,
    costUsd: 0.094,
    inputTokens: 1200,
    outputTokens: 500,
    piSessionPath: null,
  };
}

function artifact(kind: "plan" | "blast-radius" | "scenarios" | "execution-dag", body: string): Artifact {
  return {
    fm: {
      task: "T-1",
      kind,
      parent: kind === "plan" ? null : "plan.md",
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
