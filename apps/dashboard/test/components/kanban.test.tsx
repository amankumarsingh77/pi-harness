import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { KanbanBoard } from "@/components/kanban/board";
import type { Task } from "@pi-harness/shared";

type MockDndEntity = {
  readonly id: string;
  readonly data?: unknown;
};

type MockDragEndEvent = {
  readonly canceled: boolean;
  readonly operation: {
    readonly source: MockDndEntity | null;
    readonly target: MockDndEntity | null;
  };
};

type MockDraggableInput = MockDndEntity & {
  readonly disabled?: boolean;
};

const dndKitMock = vi.hoisted(() => ({
  draggables: new Map<string, MockDraggableInput>(),
  droppables: new Map<string, MockDndEntity>(),
  onDragStart: null as ((event: Omit<MockDragEndEvent, "canceled">) => void) | null,
  onDragEnd: null as ((event: MockDragEndEvent) => void) | null,
}));

vi.mock("@dnd-kit/react", () => ({
  DragDropProvider: ({
    children,
    onDragStart,
    onDragEnd,
  }: {
    readonly children: React.ReactNode;
    readonly onDragStart?: (event: Omit<MockDragEndEvent, "canceled">) => void;
    readonly onDragEnd?: (event: MockDragEndEvent) => void;
  }) => {
    dndKitMock.onDragStart = onDragStart ?? null;
    dndKitMock.onDragEnd = onDragEnd ?? null;
    return children;
  },
  DragOverlay: () => null,
  useDraggable: (input: MockDraggableInput) => {
    dndKitMock.draggables.set(input.id, input);
    return {
      draggable: { id: input.id, data: input.data },
      handleRef: vi.fn(),
      isDragging: false,
      isDragSource: false,
      isDropping: false,
      ref: vi.fn(),
    };
  },
  useDroppable: (input: MockDndEntity) => {
    dndKitMock.droppables.set(input.id, input);
    return {
      droppable: { id: input.id, data: input.data },
      isDropTarget: false,
      ref: vi.fn(),
    };
  },
}));

const baseTask = (overrides: Partial<Task>): Task => ({
  id: overrides.id ?? "t",
  title: "x",
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
});

describe("KanbanBoard", () => {
  beforeEach(() => {
    dndKitMock.draggables.clear();
    dndKitMock.droppables.clear();
    dndKitMock.onDragStart = null;
    dndKitMock.onDragEnd = null;
  });

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

  it("makes the whole task card a task detail link", () => {
    const tasks = [baseTask({ id: "open-me", title: "Open the whole card", status: "executing" })];
    render(<KanbanBoard tasks={tasks} counts={{ executing: 1 }} />);

    expect(screen.getByRole("link", { name: "Open Open the whole card" })).toHaveAttribute(
      "href",
      "/tasks/open-me",
    );
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

  it("renders quiet card content without tags, phase chips, status icons, or inline actions", () => {
    const tasks = [
      baseTask({
        id: "1",
        title: "Rate limit /login",
        description: "Long detail belongs on the task page, not on the board card.",
        status: "backlog",
        workflow: "backend-feature",
        priority: "urgent",
        tags: ["bugfix", "backend"],
      }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ backlog: 1 }} />);
    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.getByText("backend-feature")).toBeInTheDocument();
    expect(screen.queryByText("Urgent")).not.toBeInTheDocument();
    expect(screen.queryByText("bugfix")).not.toBeInTheDocument();
    expect(screen.queryByText("backend")).not.toBeInTheDocument();
    expect(screen.queryByText("ready to start")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start brainstorm/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Long detail belongs/)).not.toBeInTheDocument();
  });

  it("only backlog cards are draggable as whole cards", () => {
    const tasks = [
      baseTask({ id: "backlog", title: "Can start", status: "backlog" }),
      baseTask({ id: "running", title: "Cannot move", status: "executing" }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ backlog: 1, executing: 1 }} />);
    expect(screen.queryByRole("button", { name: /drag .* to brainstorming/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("task-card-backlog")).not.toHaveAttribute("draggable", "true");
    expect(screen.getByTestId("task-card-running")).not.toHaveAttribute("draggable", "true");
    expect(dndKitMock.draggables.get("task:backlog")?.disabled).toBe(false);
    expect(dndKitMock.draggables.get("task:running")?.disabled).toBe(true);
  });

  it("highlights the Brainstorming drop area while a backlog card is active", async () => {
    const tasks = [baseTask({ id: "drag-me", title: "Drag me", status: "backlog" })];
    render(<KanbanBoard tasks={tasks} counts={{ backlog: 1 }} />);

    await act(async () => {
      simulateDndStart("task:drag-me");
    });

    expect(screen.getByTestId("kanban-column-brainstorming")).toHaveTextContent(
      "drop to start brainstorm",
    );
  });

  it("keeps card click navigation separate from drag start", () => {
    const transitions: { taskId: string; action: unknown }[] = [];
    const tasks = [baseTask({ id: "open-me", title: "Open without dragging", status: "backlog" })];
    render(
      <KanbanBoard
        tasks={tasks}
        counts={{ backlog: 1 }}
        onTransition={async (taskId, action) => {
          transitions.push({ taskId, action });
        }}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open Open without dragging" }));

    expect(transitions).toEqual([]);
  });

  it("starts brainstorm exactly once when a backlog card is dropped on Brainstorming", async () => {
    const transitions: { taskId: string; action: unknown }[] = [];
    const tasks = [baseTask({ id: "drag-me", title: "Drag me", status: "backlog" })];
    render(
      <KanbanBoard
        tasks={tasks}
        counts={{ backlog: 1 }}
        onTransition={async (taskId, action) => {
          transitions.push({ taskId, action });
        }}
      />,
    );

    await act(async () => {
      simulateDndDrop("task:drag-me", "column:brainstorming");
    });

    await waitFor(() => expect(transitions).toEqual([
      {
        taskId: "drag-me",
        action: { type: "user_start_brainstorm", workflow: "backend-feature" },
      },
    ]));
  });

  it("does not start brainstorm when drag is cancelled or dropped away from Brainstorming", async () => {
    const transitions: { taskId: string; action: unknown }[] = [];
    const tasks = [baseTask({ id: "drag-me", title: "Drag me", status: "backlog" })];
    render(
      <KanbanBoard
        tasks={tasks}
        counts={{ backlog: 1 }}
        onTransition={async (taskId, action) => {
          transitions.push({ taskId, action });
        }}
      />,
    );

    await act(async () => {
      simulateDndDrop("task:drag-me", "column:planning");
      simulateDndDrop("task:drag-me", "column:brainstorming", { canceled: true });
    });

    expect(transitions).toEqual([]);
  });

  it("verification_failed card uses a blocked stripe without retry meta or red border", () => {
    const tasks = [
      baseTask({
        id: "2",
        title: "Theme switcher persistence",
        status: "verification_failed",
        retryCount: 1,
      }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{ verification_failed: 1 }} />);
    const card = screen.getByTestId("task-card-2");
    expect(screen.queryByText("retry 1/2")).not.toBeInTheDocument();
    expect(card.className).not.toMatch(/border-st-blocked/);
    expect(screen.getByTestId("task-card-stripe-2")).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-card-stripe-blocked)"),
    );
  });

  it("empty columns show the drop placeholder affordance", () => {
    render(<KanbanBoard tasks={[]} counts={{}} />);
    expect(screen.getAllByText("drop here · or ⌘N")).toHaveLength(1);
  });

  it("brainstorm_failed task buckets into Brainstorming with a blocked stripe only", () => {
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

    const card = screen.getByTestId("task-card-3");
    expect(card.className).not.toMatch(/border-st-blocked/);
    expect(screen.queryByText("brainstorm failed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("task-card-stripe-3")).toHaveAttribute(
      "style",
      expect.stringContaining("var(--color-card-stripe-blocked)"),
    );
  });

  it("plan_failed / code_failed / pr_failed bucket under their parent phase columns without phase text", () => {
    const tasks = [
      baseTask({ id: "p", title: "plan crashed", status: "plan_failed" }),
      baseTask({ id: "c", title: "code crashed", status: "code_failed" }),
      baseTask({ id: "r", title: "pr crashed", status: "pr_failed" }),
    ];
    render(<KanbanBoard tasks={tasks} counts={{}} />);
    expect(screen.getByText("plan crashed")).toBeInTheDocument();
    expect(screen.getByText("code crashed")).toBeInTheDocument();
    expect(screen.getByText("pr crashed")).toBeInTheDocument();
    expect(screen.queryByText("plan failed")).not.toBeInTheDocument();
    expect(screen.queryByText("code failed")).not.toBeInTheDocument();
    expect(screen.queryByText("PR failed")).not.toBeInTheDocument();
  });

  it("renders the board toolbar and disabled future views", () => {
    render(<KanbanBoard tasks={[]} counts={{}} />);
    expect(screen.getByRole("toolbar", { name: "Board controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Calendar" })).toBeDisabled();
    expect(screen.getByText("0 cards idle > 30m · auto-cleanup ok")).toBeInTheDocument();
  });

  it("filters visible cards by workflow and removes a filter pill", () => {
    const tasks = [
      baseTask({ id: "backend", title: "Backend task", workflow: "backend-feature" }),
      baseTask({ id: "other", title: "No workflow task", workflow: null }),
    ];
    render(
      <KanbanBoard
        tasks={tasks}
        counts={{ backlog: 2 }}
        initialFilters={{ workflow: "backend-feature" }}
      />,
    );

    expect(screen.getByText("Backend task")).toBeInTheDocument();
    expect(screen.queryByText("No workflow task")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove workflow filter" }));
    expect(screen.getByText("No workflow task")).toBeInTheDocument();
  });
});

function simulateDndDrop(
  sourceId: string,
  targetId: string | null,
  options: { readonly canceled?: boolean } = {},
): void {
  const source = dndKitMock.draggables.get(sourceId);
  if (!source) throw new Error(`Missing draggable ${sourceId}`);
  const target = targetId === null ? null : dndKitMock.droppables.get(targetId) ?? null;
  dndKitMock.onDragEnd?.({
    canceled: options.canceled ?? false,
    operation: {
      source,
      target,
    },
  });
}

function simulateDndStart(sourceId: string): void {
  const source = dndKitMock.draggables.get(sourceId);
  if (!source) throw new Error(`Missing draggable ${sourceId}`);
  dndKitMock.onDragStart?.({
    operation: {
      source,
      target: null,
    },
  });
}
