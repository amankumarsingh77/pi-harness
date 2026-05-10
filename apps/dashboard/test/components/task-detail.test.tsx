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

  it("shows event count and short run id in the header", () => {
    const events: AgentEvent[] = [];
    render(<AgentLog events={events} runId="r_8f3a91c2" />);
    expect(screen.getByText(/r_8f3a/)).toBeInTheDocument();
    expect(screen.getByText(/0 events/)).toBeInTheDocument();
  });
});
