import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import type { AgentEvent, Run } from "@pi-harness/shared";

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
