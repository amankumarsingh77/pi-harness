import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhaseRail } from "@/components/task-detail/phase-rail";
import { AgentLog } from "@/components/task-detail/agent-log";
import type { AgentEvent, Run } from "@pi-harness/shared";
import type { MockDeepLinks } from "@/types/mocks";

const ALL_LINKS_AVAILABLE: MockDeepLinks = {
  brainstorm: { available: true, href: "/tasks/T-1/brainstorm" },
  plan:       { available: true, href: "/tasks/T-1/plan" },
  verify:     { available: true, href: "/tasks/T-1/verify" },
};

describe("PhaseRail", () => {
  it("renders all 7 rail steps (Intake + 5 phases + Done)", () => {
    render(<PhaseRail runs={[]} deepLinks={ALL_LINKS_AVAILABLE} />);
    for (const name of ["Intake", "Brainstorm", "Plan", "Code", "Verify", "PR", "Done"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("disables the verify deep-link when not available", () => {
    const links: MockDeepLinks = {
      ...ALL_LINKS_AVAILABLE,
      verify: { available: false, reason: "Code phase has not finished yet" },
    };
    render(<PhaseRail runs={[]} deepLinks={links} />);
    const verify = screen.getByText("Open verify").closest("[aria-disabled='true']");
    expect(verify).not.toBeNull();
  });
});

describe("AgentLog", () => {
  it("derives the phase column from phase_started events", () => {
    const events: AgentEvent[] = [
      { id: "1", taskId: "t", runId: "r_abc", ts: new Date("2026-05-08T14:32:01Z"), kind: "phase_started", phase: "code" },
      { id: "2", taskId: "t", runId: "r_abc", ts: new Date("2026-05-08T14:32:18Z"), kind: "tool_result", tool: "vitest", ok: false },
    ];
    render(<AgentLog events={events} runId="r_abc" />);
    // both rows belong to the "code" phase since phase_started:code preceded them
    expect(screen.getAllByText("code").length).toBeGreaterThanOrEqual(2);
  });

  it("renders a tool_result row using the tool name", () => {
    const events: AgentEvent[] = [
      { id: "1", taskId: "t", runId: "r_abc", ts: new Date("2026-05-08T14:32:18Z"), kind: "tool_result", tool: "vitest", ok: false },
    ];
    render(<AgentLog events={events} runId="r_abc" />);
    expect(screen.getByText(/test runner/)).toBeInTheDocument();
  });

  it("shows event count and short run id in the header", () => {
    const events: AgentEvent[] = [];
    render(<AgentLog events={events} runId="r_8f3a91c2" />);
    expect(screen.getByText(/r_8f3a/)).toBeInTheDocument();
    expect(screen.getByText(/0 events/)).toBeInTheDocument();
  });
});
