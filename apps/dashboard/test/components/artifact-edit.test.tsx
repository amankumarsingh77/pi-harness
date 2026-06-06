import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Artifact } from "@pi-harness/shared";

const { editMock } = vi.hoisted(() => ({
  editMock: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("@/app/tasks/[id]/actions", () => ({
  submitArtifactEditAction: editMock,
  approveBrainstormAction: vi.fn(),
  requestBrainstormChangesAction: vi.fn(),
  submitBrainstormAnswersAction: vi.fn(),
  submitBrainstormNudgeAction: vi.fn(),
  restartBrainstormAction: vi.fn(),
}));

beforeEach(() => {
  editMock.mockClear();
  cleanup();
});

import { ArtifactBlock } from "@/components/brainstorm/artifact-block";

function withQuery(node: React.ReactNode): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const SAMPLE: Artifact = {
  fm: {
    task: "t1",
    kind: "design",
    parent: null,
    branch: "pi/t1",
    status: "draft",
    last_updated: "2026-05-09T15:00:00.000Z",
    last_updated_by: "agent",
  },
  body: "# Design\n\nbody body body\n",
};

describe("ArtifactBlock — edit mode", () => {
  it("renders final markdown inside the readable artifact document wrapper", () => {
    render(
      withQuery(
        <ArtifactBlock
          taskId="t1"
          taskStatus="planning"
          kind="design"
          artifact={SAMPLE}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Design" }).closest(".artifact-doc")).not.toBeNull();
  });

  it("hides the Edit toggle once the task is past brainstorming", () => {
    render(
      withQuery(
        <ArtifactBlock
          taskId="t1"
          taskStatus="planning"
          kind="design"
          artifact={SAMPLE}
        />,
      ),
    );
    expect(screen.queryByTestId("mode-edit")).toBeNull();
  });

  it("shows Edit toggle and an editable textarea while brainstorming", () => {
    render(
      withQuery(
        <ArtifactBlock
          taskId="t1"
          taskStatus="brainstorming"
          kind="design"
          artifact={SAMPLE}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("mode-edit"));
    const ta = screen.getByLabelText(/edit design body/i);
    expect(ta).toBeInTheDocument();
    expect((ta as HTMLTextAreaElement).value).toBe(SAMPLE.body);
  });

  it("calls the edit action with the modified body and exits edit mode", async () => {
    render(
      withQuery(
        <ArtifactBlock
          taskId="t1"
          taskStatus="brainstorming"
          kind="design"
          artifact={SAMPLE}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("mode-edit"));
    const ta = screen.getByLabelText(/edit design body/i);
    fireEvent.change(ta, { target: { value: "# Design\n\nuser edited\n" } });
    fireEvent.click(screen.getByRole("button", { name: /save edit/i }));
    await waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));
    expect(editMock).toHaveBeenCalledWith("t1", "design", "# Design\n\nuser edited\n");
  });

  it("returns to Final mode without firing the action when body is unchanged", () => {
    render(
      withQuery(
        <ArtifactBlock
          taskId="t1"
          taskStatus="brainstorming"
          kind="design"
          artifact={SAMPLE}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("mode-edit"));
    fireEvent.click(screen.getByRole("button", { name: /save edit/i }));
    expect(editMock).not.toHaveBeenCalled();
  });

  it("Cancel restores the original body and exits edit mode", () => {
    render(
      withQuery(
        <ArtifactBlock
          taskId="t1"
          taskStatus="brainstorming"
          kind="design"
          artifact={SAMPLE}
        />,
      ),
    );
    fireEvent.click(screen.getByTestId("mode-edit"));
    const ta = screen.getByLabelText(/edit design body/i);
    fireEvent.change(ta, { target: { value: "scratch" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Edit pane gone.
    expect(screen.queryByLabelText(/edit design body/i)).toBeNull();
    expect(editMock).not.toHaveBeenCalled();
  });
});
