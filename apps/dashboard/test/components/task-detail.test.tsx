import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import { TaskActivityPanel } from "@/components/task-detail/task-activity-panel";
import { TaskDetailInspectors } from "@/components/task-detail/task-detail-inspectors";
import { TaskDetailShell } from "@/components/task-detail/task-detail-shell";
import { TaskFactsPanel } from "@/components/task-detail/task-facts-panel";
import { TaskPhaseStrip } from "@/components/task-detail/task-phase-strip";
import {
  deriveTaskIntervention,
  TaskInterventionStrip,
} from "@/components/task-detail/task-intervention";
import type { RunFile } from "@/lib/api";
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

describe("TaskPhaseStrip", () => {
  it("renders the focused 7-phase strip with the current phase highlighted", () => {
    render(
      <TaskPhaseStrip
        task={task({ status: "planning" })}
        runs={[run({ phase: "brainstorm", status: "succeeded" }), run({ phase: "plan", status: "running" })]}
      />,
    );

    for (const name of ["Intake", "Brainstorm", "Plan", "Code", "Verify", "PR", "Done"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText(/live/)).toBeInTheDocument();
    expect(screen.getAllByText("queued").length).toBeGreaterThan(0);
    expect(screen.getByText("Current phase: Plan")).toBeInTheDocument();
  });

  it("links only phase pages that have supporting output", () => {
    render(
      <TaskPhaseStrip
        task={task({ status: "planning" })}
        runs={[run({ phase: "brainstorm", status: "succeeded" }), run({ phase: "plan", status: "running" })]}
      />,
    );

    expect(screen.getByRole("link", { name: /open brainstorm/i })).toHaveAttribute(
      "href",
      "/tasks/T-1/brainstorm",
    );
    expect(screen.getByRole("link", { name: /open plan/i })).toHaveAttribute(
      "href",
      "/tasks/T-1/plan",
    );
    expect(screen.queryByRole("link", { name: /open verify/i })).toBeNull();
  });
});

describe("Focused task detail panels", () => {
  it("links to Mission Command from the task detail header", () => {
    render(
      <TaskDetailShell task={task()} runs={[]} liveRunId={null} inspectorControls={null}>
        <div />
      </TaskDetailShell>,
    );

    expect(screen.getByRole("link", { name: "Mission Command" })).toHaveAttribute(
      "href",
      "/tasks/T-1/mission",
    );
  });

  it("renders latest activity and task facts instead of the old full-height grid", () => {
    const selectedRun = run({ phase: "plan", status: "running" });

    render(
      <div>
        <TaskActivityPanel events={[logEvent({ text: "plan-author wrote implementation plan" })]} />
        <TaskFactsPanel
          task={task({ status: "planning" })}
          runs={[selectedRun]}
          files={[file({ path: "apps/dashboard/app/tasks/[id]/page.tsx", added: 42 })]}
          selectedRunId={selectedRun.id}
        />
      </div>,
    );

    expect(screen.getByText("Latest activity")).toBeInTheDocument();
    expect(screen.getByText("Task facts")).toBeInTheDocument();
    expect(screen.getByText(/plan-author wrote implementation plan/)).toBeInTheDocument();
    expect(screen.getByText("Run context")).toBeInTheDocument();
    expect(screen.getByText("Files touched")).toBeInTheDocument();
  });

  it("renders purposeful guidance before the first run starts", () => {
    render(
      <div>
        <TaskActivityPanel events={[]} />
        <TaskFactsPanel
          task={task({ status: "backlog", branchName: null, worktreePath: null })}
          runs={[]}
          files={[]}
        />
      </div>,
    );

    expect(screen.getByText(/Start brainstorm to create the first run/)).toBeInTheDocument();
    expect(screen.getByText(/No run history yet/)).toBeInTheDocument();
  });

  it("opens read-only inspector surfaces without workflow mutation labels", () => {
    const selectedRun = run({ phase: "code", status: "running" });

    render(
      <TaskDetailInspectors
        events={[logEvent({ text: "running tests" })]}
        files={[file({ path: "src/auth/redirect.ts", added: 12, removed: 2 })]}
        artifactSummaries={[
          {
            name: "plan.md",
            status: "ready",
            lines: 96,
            phase: "plan",
            href: "/tasks/T-1/plan",
            preview: "Implementation plan",
          },
        ]}
        runId={selectedRun.id}
        live={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Inspect log" }));
    expect(screen.getByRole("dialog", { name: "Live log drawer" })).toBeInTheDocument();
    expect(screen.getByText("running tests")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect changes" }));
    expect(screen.getByRole("dialog", { name: "Changed files modal" })).toBeInTheDocument();
    expect(screen.getByText("src/auth/redirect.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect artifacts" }));
    expect(screen.getByRole("dialog", { name: "Artifacts modal" })).toBeInTheDocument();
    expect(screen.getAllByText("plan.md").length).toBeGreaterThan(0);

    for (const label of ["Approve", "Cancel", "Retry", "Restart", "Request changes"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
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

  it("pairs overlapping same-tool calls by callId", () => {
    const events: AgentEvent[] = [
      {
        id: "1",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:01Z"),
        kind: "tool_call",
        callId: "call-a",
        tool: "read",
        input: { path: "a.ts" },
      },
      {
        id: "2",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:02Z"),
        kind: "tool_call",
        callId: "call-b",
        tool: "read",
        input: { path: "b.ts" },
      },
      {
        id: "3",
        taskId: "t",
        runId: "r_abc",
        ts: new Date("2026-05-08T14:32:03Z"),
        kind: "tool_result",
        callId: "call-a",
        tool: "read",
        ok: false,
      },
    ];

    render(<AgentLog events={events} runId="r_abc" />);

    const rows = screen.getAllByRole("button").filter((row) =>
      row.textContent?.includes("read("),
    );
    expect(rows[0]).toHaveTextContent("read(a.ts)✗");
    expect(rows[1]).toHaveTextContent("read(b.ts)…");
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

  it("renders plan lifecycle events with non-empty messages", () => {
    const events: AgentEvent[] = [
      {
        id: "1",
        taskId: "t",
        runId: "r_plan",
        ts: new Date("2026-05-08T14:32:01Z"),
        kind: "phase_started",
        phase: "plan",
      },
      {
        id: "2",
        taskId: "t",
        runId: "r_plan",
        ts: new Date("2026-05-08T14:32:02Z"),
        kind: "plan_system",
        systemKind: "preflight_started",
      },
      {
        id: "3",
        taskId: "t",
        runId: "r_plan",
        ts: new Date("2026-05-08T14:32:03Z"),
        kind: "plan_subagent_started",
        subagent: "repo-cartographer",
        sessionId: "s_1",
      },
      {
        id: "4",
        taskId: "t",
        runId: "r_plan",
        ts: new Date("2026-05-08T14:32:04Z"),
        kind: "plan_subagent_ended",
        subagent: "repo-cartographer",
        sessionId: "s_1",
        ok: true,
        durationMs: 1000,
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 20,
      },
      {
        id: "5",
        taskId: "t",
        runId: "r_plan",
        ts: new Date("2026-05-08T14:32:05Z"),
        kind: "plan_usage",
        tickIndex: 1,
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.0123,
        cumulativeInputTokens: 1000,
        cumulativeOutputTokens: 200,
        cumulativeCostUsd: 0.0123,
      },
    ];
    render(<AgentLog events={events} runId="r_plan" />);
    expect(screen.getByText("preflight started")).toBeInTheDocument();
    expect(screen.getByText("research started · repo-cartographer")).toBeInTheDocument();
    expect(screen.getByText("research complete · repo-cartographer")).toBeInTheDocument();
    expect(screen.getByText("usage · 1,000 in / 200 out · $0.0123")).toBeInTheDocument();
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

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "r_8f3a91c2",
    taskId: "T-1",
    phase: "brainstorm",
    status: "succeeded",
    startedAt: new Date("2026-05-08T14:00:00Z"),
    endedAt: new Date("2026-05-08T14:01:00Z"),
    error: null,
    costUsd: 0.02,
    inputTokens: 1000,
    outputTokens: 500,
    piSessionPath: null,
    ...overrides,
  };
}

function file(overrides: Partial<RunFile> = {}): RunFile {
  return {
    path: "src/auth/redirect.ts",
    added: 1,
    removed: 0,
    state: "settled",
    ...overrides,
  };
}

function logEvent(overrides: Partial<Extract<AgentEvent, { kind: "log" }>> = {}): Extract<AgentEvent, { kind: "log" }> {
  return {
    id: "event-1",
    taskId: "T-1",
    runId: "r_8f3a91c2",
    ts: new Date("2026-05-08T14:32:01Z"),
    kind: "log",
    level: "info",
    text: "plan-author wrote implementation plan",
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
