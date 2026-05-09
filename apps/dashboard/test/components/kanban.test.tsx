import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanBoard } from "@/components/kanban/board";
import type { Task } from "@pi-harness/shared";

const baseTask = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? "t",
  title: "x",
  description: "",
  status: "backlog",
  workflow: null,
  worktreePath: null,
  branchName: null,
  retryCount: 0,
  awaitingApproval: false,
  phaseModels: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("KanbanBoard", () => {
  it("renders all 8 columns (Linear-style capitalized titles)", () => {
    render(<KanbanBoard tasks={[]} counts={{}} />);
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Brainstorming")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getByText("Verifying")).toBeInTheDocument();
    expect(screen.getByText("Verify Failed")).toBeInTheDocument();
    expect(screen.getByText("Ready to Ship")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows column counts from props in the column header", () => {
    render(<KanbanBoard tasks={[]} counts={{ backlog: 3, executing: 1 }} />);
    const backlogHeader = screen.getByText("Backlog").closest("header")!;
    expect(backlogHeader).toHaveTextContent("3");
  });

  it("renders task in matching column", () => {
    const tasks = [
      baseTask({ id: "1", title: "API change", status: "executing", workflow: "backend-feature" }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ executing: 1 }} />);
    expect(screen.getByText("API change")).toBeInTheDocument();
  });

  it("active executing card surfaces branch name in mono meta", () => {
    const tasks = [
      baseTask({
        id: "1",
        title: "Rate limit /login",
        status: "executing",
        workflow: "backend-feature",
        branchName: "feat/rate-limit-login",
      }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ executing: 1 }} />);
    expect(screen.getByText("feat/rate-limit-login")).toBeInTheDocument();
  });

  it("verification_failed card carries blocked retry meta", () => {
    const tasks = [
      baseTask({
        id: "2",
        title: "Theme switcher persistence",
        status: "verification_failed",
        retryCount: 1,
      }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ verification_failed: 1 }} />);
    expect(screen.getByText("retry 1/2")).toBeInTheDocument();
  });

  it("empty columns show an 'empty' affordance", () => {
    render(<KanbanBoard tasks={[]} counts={{}} />);
    // 8 columns, all empty
    expect(screen.getAllByText("empty")).toHaveLength(8);
  });
});
