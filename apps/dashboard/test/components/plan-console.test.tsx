import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentEvent, Artifact, Run, Task } from "@pi-harness/shared";
import { PlanApprovalGate } from "@/components/plan/approval-gate";
import { PlanConsole } from "@/components/plan/plan-console";
import type { PlanJsonlEvent } from "@/lib/api";
import { PlanEventsProvider } from "@/lib/plan-events-context";

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

  it("opens expanded artifact modals for plan, blast radius, and scenarios", () => {
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
});

describe("PlanApprovalGate", () => {
  it("keeps approve and request-change actions in the existing phase gate", () => {
    render(<PlanApprovalGate taskId="T-1" gate="awaiting_user" taskStatus="planning" />);

    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeInTheDocument();
  });
});

function renderConsole() {
  return render(
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
        research={{
          "codebase-scout": "# Scout\n\nNo backend change needed.",
          "integration-scanner": null,
          "precedent-locator": null,
          "claim-verifier": null,
        }}
        planEvents={planEvents}
        liveEvents={liveEvents}
        connected={true}
        plannerLogDefaultOpen
      />
    </PlanEventsProvider>,
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

function artifact(kind: "plan" | "blast-radius" | "scenarios", body: string): Artifact {
  return {
    fm: {
      task: "T-1",
      kind,
      parent: kind === "scenarios" || kind === "blast-radius" ? "plan.md" : null,
      status: "ready",
      branch: "codex/task-detail-redesign",
      last_updated: "2026-05-15T10:04:00Z",
      last_updated_by: "plan-agent",
    },
    body,
  };
}

function started(subagent: string, sessionId: string): PlanJsonlEvent {
  return {
    kind: "plan_subagent_started",
    ts: "2026-05-15T10:02:00.000Z",
    subagent,
    sessionId,
  };
}

function ended(
  subagent: string,
  sessionId: string,
  ok: boolean,
  durationMs: number,
  costUsd: number,
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
