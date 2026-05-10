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

  it("brainstorm_failed task buckets into Brainstorming column with blocked meta and red border", () => {
    const tasks = [
      baseTask({
        id: "3",
        title: "Brainstorm crashed mid-tick",
        status: "brainstorm_failed",
        workflow: "backend-feature",
      }),
    ];
    render(
      <KanbanBoard
        tasks={tasks}
        counts={{ brainstorming: 0, brainstorm_failed: 1 }}
      />,
    );

    // Card visible — and the Brainstorming column it landed in shows count 1
    // (the brainstorm_failed count was folded into brainstorming).
    expect(screen.getByText("Brainstorm crashed mid-tick")).toBeInTheDocument();
    const brainstormHeader = screen.getByText("Brainstorming").closest("header")!;
    expect(brainstormHeader).toHaveTextContent("1");

    // Card has the "brainstorm failed" meta and a red border style.
    expect(screen.getByText("brainstorm failed")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /brainstorm crashed mid-tick/i });
    expect(link.className).toMatch(/border-st-blocked/);
  });

  it("plan_failed / code_failed / pr_failed bucket under their parent phase columns", () => {
    const tasks = [
      baseTask({ id: "p", title: "plan crashed", status: "plan_failed" }),
      baseTask({ id: "c", title: "code crashed", status: "code_failed" }),
      baseTask({ id: "r", title: "pr crashed", status: "pr_failed" }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{}} />);
    expect(screen.getByText("plan crashed")).toBeInTheDocument();
    expect(screen.getByText("code crashed")).toBeInTheDocument();
    expect(screen.getByText("pr crashed")).toBeInTheDocument();
    expect(screen.getByText("plan failed")).toBeInTheDocument();
    expect(screen.getByText("code failed")).toBeInTheDocument();
    expect(screen.getByText("PR failed")).toBeInTheDocument();
  });
});
