import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "@pi-harness/shared";
import { BrainstormShell } from "@/components/brainstorm/shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/brainstorm-events-context", () => ({
  useBrainstormEvents: () => ({ events: [], connected: true }),
}));

vi.mock("@/app/tasks/[id]/actions", () => ({
  approveBrainstormAction: vi.fn(),
  requestBrainstormChangesAction: vi.fn(),
  restartBrainstormAction: vi.fn(),
  submitArtifactEditAction: vi.fn(),
  submitBrainstormAnswersAction: vi.fn(),
  submitBrainstormMockEditAction: vi.fn(),
  submitBrainstormNudgeAction: vi.fn(),
  selectBrainstormMockAction: vi.fn(),
}));

describe("BrainstormShell", () => {
  it("resizes columns by dragging vertical separators", () => {
    render(
      <BrainstormShell
        task={task()}
        runId="run-1"
        gate="running"
        design={null}
        spec={null}
        initialEvents={[]}
        initialAgentEvents={[]}
        canCancel={false}
        cancelled={false}
      />,
    );

    const grid = screen.getByTestId("brainstorm-grid");
    Object.defineProperty(grid, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 640,
        width: 1200,
        height: 640,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(screen.getByRole("separator", { name: /resize event rail/i }), {
      clientX: 280,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 340, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(grid).toHaveStyle({
      gridTemplateColumns: "340px 10px minmax(360px, 1fr) 10px 380px",
    });
  });
});

function task(): Task {
  return {
    id: "T-1",
    title: "Resizable brainstorm",
    description: "Make the brainstorm page panes resizable.",
    status: "brainstorming",
    workflow: "backend-feature",
    worktreePath: null,
    branchName: null,
    retryCount: 0,
    priority: "medium",
    tags: [],
    phaseModels: {},
    createdAt: new Date("2026-05-29T00:00:00.000Z"),
    updatedAt: new Date("2026-05-29T00:00:00.000Z"),
  };
}
