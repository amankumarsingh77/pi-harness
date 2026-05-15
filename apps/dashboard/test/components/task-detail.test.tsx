import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import {
  deriveTaskIntervention,
  TaskInterventionStrip,
} from "@/components/task-detail/task-intervention";
import type { BrainstormJsonlEvent } from "@/lib/api";
import type { AgentEvent, Run, Task } from "@pi-harness/shared";

describe("PhaseRail", () => {
  it("renders all 7 rail steps (Intake + 5 phases + Done)", () => {
    render(<PhaseRail runs={[]} taskId="T-1" />);
    for (const name of ["Intake", "Brainstorm", "Plan", "Code", "Verify", "PR", "Done"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("makes the brainstorm step a link once a brainstorm run exists", () => {
    const runs: Run[] = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        taskId: "00000000-0000-4000-8000-0000000000aa",
        phase: "brainstorm",
        status: "succeeded",
        startedAt: new Date("2026-05-08T14:00:00Z"),
        endedAt: new Date("2026-05-08T14:01:00Z"),
        error: null,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        piSessionPath: null,
      },
    ];
    render(<PhaseRail runs={runs} taskId="T-1" />);
    const link = screen.getByRole("link", { name: /open brainstorm/i });
    expect(link.getAttribute("href")).toBe("/tasks/T-1/brainstorm");
  });

  it("does not render a verify link when code has not started", () => {
    render(<PhaseRail runs={[]} taskId="T-1" />);
    expect(screen.queryByRole("link", { name: /open verify/i })).toBeNull();
  });
});

describe("AgentLog", () => {
  it("derives the phase column from phase_started events", () => {
    const events: AgentEvent[] = [
      {
        id: "1",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:01Z"),
        kind: "phase_started",
        phase: "code",
      },
      {
        id: "2",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:18Z"),
        kind: "tool_call",
        tool: "bash",
        input: { command: "pnpm test" },
      },
    ];
    render(<AgentLog events={events} runId="r_abc" />);
    expect(screen.getAllByText("code").length).toBeGreaterThanOrEqual(2);
  });

  it("renders a bash tool_call with its command summary", () => {
    const events: AgentEvent[] = [
      {
        id: "1",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:18Z"),
        kind: "tool_call",
        tool: "bash",
        input: { command: "pnpm test" },
      },
    ];
    render(<AgentLog events={events} runId="r_abc" />);
    expect(screen.getByText(/bash\(pnpm test\)/)).toBeInTheDocument();
  });

  it("pairs a tool_call with its tool_result and shows the failure badge", () => {
    const events: AgentEvent[] = [
      {
        id: "1",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:01Z"),
        kind: "tool_call",
        tool: "bash",
        input: { command: "pnpm test" },
      },
      {
        id: "2",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:05Z"),
        kind: "tool_result",
        tool: "bash",
        ok: false,
      },
    ];
    render(<AgentLog events={events} runId="r_abc" />);
    expect(screen.getByLabelText("failed")).toBeInTheDocument();
  });

  it("renders web search and fetch activity with expandable details", () => {
    const events: AgentEvent[] = [
      {
        id: "1",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:01Z"),
        kind: "tool_call",
        tool: "pi_web_search",
        input: { query: "oauth libraries node", maxResults: 3 },
        subagent: "web-search-researcher",
      },
      {
        id: "2",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:02Z"),
        kind: "tool_result",
        tool: "pi_web_search",
        ok: true,
        output: {
          details: {
            ok: true,
            provider: "tinyfish",
            query: "oauth libraries node",
            results: [{ title: "OAuth", url: "https://example.com", snippet: "docs" }],
          },
        },
        subagent: "web-search-researcher",
      },
      {
        id: "3",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:03Z"),
        kind: "tool_call",
        tool: "pi_web_fetch",
        input: { url: "https://example.com" },
        subagent: "web-search-researcher",
      },
    ];
    render(<AgentLog events={events} runId="r_abc" />);
    expect(screen.getByText(/pi_web_search\("oauth libraries node"\)/)).toBeInTheDocument();
    expect(screen.getByText(/pi_web_fetch\(https:\/\/example.com\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/pi_web_search/));
    expect(screen.getByText(/tinyfish/)).toBeInTheDocument();
    expect(screen.getAllByText(/https:\/\/example.com/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows event count and short run id in the header", () => {
    const events: AgentEvent[] = [];
    render(<AgentLog events={events} runId="r_8f3a91c2" />);
    expect(screen.getByText(/r_8f3a/)).toBeInTheDocument();
    expect(screen.getByText(/0 events/)).toBeInTheDocument();
  });
});

describe("TaskIntervention", () => {
  it("routes unanswered brainstorm questions to the brainstorm phase page", () => {
    const intervention = deriveTaskIntervention({
      task: task({ status: "brainstorming" }),
      brainstorm: {
        gate: "running",
        events: [
          question({ questionId: "q1", batchId: "b1", prompt: "Choose a workflow" }),
        ],
      },
    });

    expect(intervention).toMatchObject({
      phase: "brainstorm",
      title: "Brainstorm needs your answers",
      href: "/tasks/T-1/brainstorm",
      cta: "Answer questions",
    });
  });

  it("routes unselected brainstorm mocks to the brainstorm phase page", () => {
    const intervention = deriveTaskIntervention({
      task: task({ status: "brainstorming" }),
      brainstorm: {
        gate: "running",
        events: [
          {
            kind: "brainstorm_mock_proposed",
            ts: "2026-05-08T14:32:01Z",
            mock: {
              mockId: "mock-a",
              title: "Focused command",
              summary: "Thin intervention strip",
              recommended: true,
              createdAt: "2026-05-08T14:32:01Z",
              pages: [],
            },
          },
        ],
      },
    });

    expect(intervention).toMatchObject({
      phase: "brainstorm",
      title: "Brainstorm needs a mock selection",
      href: "/tasks/T-1/brainstorm",
      cta: "Select mock",
    });
  });

  it("routes brainstorm approval to the brainstorm phase page", () => {
    const intervention = deriveTaskIntervention({
      task: task({ status: "brainstorming" }),
      brainstorm: { gate: "awaiting_user", events: [] },
    });

    expect(intervention).toMatchObject({
      phase: "brainstorm",
      title: "Brainstorm is ready for review",
      href: "/tasks/T-1/brainstorm",
      cta: "Review brainstorm",
    });
  });

  it("routes plan approval to the plan phase page", () => {
    const intervention = deriveTaskIntervention({
      task: task({ status: "planning" }),
      plan: { gate: "awaiting_user" },
    });

    expect(intervention).toMatchObject({
      phase: "plan",
      title: "Plan is ready for review",
      href: "/tasks/T-1/plan",
      cta: "Review plan",
    });
  });

  it("routes phase failures to their dedicated phase pages when available", () => {
    const intervention = deriveTaskIntervention({
      task: task({ status: "plan_failed" }),
    });

    expect(intervention).toMatchObject({
      phase: "plan",
      title: "Plan needs attention",
      href: "/tasks/T-1/plan",
      cta: "Open plan",
    });
  });

  it("does not render an intervention for normal running states without required input", () => {
    expect(
      deriveTaskIntervention({
        task: task({ status: "executing" }),
      }),
    ).toBeNull();
  });

  it("renders navigation without workflow mutation buttons", () => {
    render(
      <TaskInterventionStrip
        intervention={{
          phase: "plan",
          title: "Plan is ready for review",
          detail: "Review and approve from the dedicated phase page.",
          href: "/tasks/T-1/plan",
          cta: "Review plan",
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Review plan" })).toHaveAttribute(
      "href",
      "/tasks/T-1/plan",
    );
    expect(screen.queryByRole("button")).toBeNull();
    for (const label of ["Approve", "Cancel", "Retry", "Restart"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "T-1",
    title: "Auth redirect after login on mobile",
    description: "Preserve the requested URL after login.",
    status: "executing",
    workflow: "backend-feature",
    worktreePath: ".harness/worktrees/T-1",
    branchName: "pi/T-1",
    retryCount: 0,
    priority: "medium",
    tags: [],
    phaseModels: {},
    createdAt: new Date("2026-05-08T14:00:00Z"),
    updatedAt: new Date("2026-05-08T14:30:00Z"),
    ...overrides,
  };
}

function question(
  overrides: Partial<Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }>>,
): Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }> {
  return {
    kind: "brainstorm_question",
    ts: "2026-05-08T14:32:01Z",
    questionId: "q1",
    batchId: "b1",
    prompt: "Choose a workflow",
    options: [
      {
        id: "recommended",
        label: "Backend feature",
        recommended: true,
        evidence: ["Existing workflow"],
      },
    ],
    sectionTarget: { artifact: "design", section: "Workflow" },
    ...overrides,
  };
}
