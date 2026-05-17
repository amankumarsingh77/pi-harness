import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Task } from "@pi-harness/shared";

const { refreshMock, transitionMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  transitionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/client/queries", () => ({
  mutations: {
    transitionTask: (id: string) => ({
      mutationFn: (action: unknown) => transitionMock(id, action),
    }),
  },
}));

import { StartBrainstormButton } from "@/components/task-detail/start-brainstorm-button";

describe("StartBrainstormButton", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    transitionMock.mockReset();
    transitionMock.mockResolvedValue({ task: task({ status: "brainstorming" }) });
  });

  it("renders for backlog tasks", () => {
    render(<StartBrainstormButton task={task({ status: "backlog" })} />);

    expect(screen.getByRole("button", { name: "Start brainstorm" })).toBeInTheDocument();
  });

  it("does not render for non-backlog tasks", () => {
    render(<StartBrainstormButton task={task({ status: "brainstorming" })} />);

    expect(screen.queryByRole("button", { name: /start brainstorm/i })).toBeNull();
  });

  it("starts brainstorm and refreshes the current route", async () => {
    render(<StartBrainstormButton task={task({ id: "T-1", status: "backlog" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Start brainstorm" }));

    await waitFor(() => {
      expect(transitionMock).toHaveBeenCalledWith("T-1", {
        type: "user_start_brainstorm",
        workflow: "backend-feature",
      });
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the transition is pending", async () => {
    let resolveTransition!: () => void;
    transitionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveTransition = () => resolve({ task: task({ status: "brainstorming" }) });
      }),
    );
    render(<StartBrainstormButton task={task({ status: "backlog" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Start brainstorm" }));

    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
    resolveTransition();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("re-enables the button and shows a compact error when the transition fails", async () => {
    transitionMock.mockRejectedValue(new Error("must be in backlog"));
    render(<StartBrainstormButton task={task({ status: "backlog" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Start brainstorm" }));

    expect(await screen.findByText("must be in backlog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start brainstorm" })).toBeEnabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

function task(overrides: Partial<Task>): Task {
  return {
    id: "T-1",
    title: "Task",
    description: "",
    status: "backlog",
    workflow: null,
    worktreePath: null,
    branchName: null,
    retryCount: 0,
    priority: "none",
    tags: [],
    phaseModels: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
