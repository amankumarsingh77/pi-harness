import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RunsDashboard } from "@/components/runs/runs-dashboard";
import type { MockRun } from "@/types/mocks";

const makeRun = (overrides: Partial<MockRun> = {}): MockRun => ({
  id: "run-1",
  taskId: "task-1",
  taskTitle: "Add upload throttling",
  attempt: 1,
  branch: "feat/upload-throttle",
  startedAt: "2026-05-09T10:00:00Z",
  durationMs: 68_000,
  outcome: { kind: "running", phase: "code" },
  ...overrides,
});

describe("RunsDashboard", () => {
  it("filters runs by task title and shows match count", () => {
    render(
      <RunsDashboard
        active={[makeRun()]}
        recent={[
          makeRun({
            id: "run-2",
            taskId: "task-2",
            taskTitle: "Refine chat rail",
            outcome: { kind: "merged", pr: 42 },
          }),
        ]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/filter by task/i), {
      target: { value: "chat" },
    });

    expect(screen.getByText(/1 of 2 runs match/i)).toBeInTheDocument();
    expect(screen.getByText("Refine chat rail")).toBeInTheDocument();
    expect(screen.queryByText("Add upload throttling")).not.toBeInTheDocument();
  });

  it("shows an empty filtered state when no runs match", () => {
    render(<RunsDashboard active={[makeRun()]} recent={[]} />);

    fireEvent.change(screen.getByPlaceholderText(/filter by task/i), {
      target: { value: "missing" },
    });

    expect(screen.getByText("No runs match this filter")).toBeInTheDocument();
  });

  it("expands a row to reveal inspect metadata", () => {
    render(<RunsDashboard active={[makeRun()]} recent={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /run-1/i }));

    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.getByText("Inspect")).toBeInTheDocument();
    expect(screen.getAllByText("code · running").length).toBeGreaterThan(0);
  });
});
