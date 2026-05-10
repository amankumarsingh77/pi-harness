import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const { restartMock } = vi.hoisted(() => ({
  restartMock: vi.fn(async (..._args: unknown[]) => {}),
}));
vi.mock("@/app/tasks/[id]/actions", () => ({
  restartBrainstormAction: restartMock,
  approveBrainstormAction: vi.fn(),
  requestBrainstormChangesAction: vi.fn(),
  submitBrainstormAnswersAction: vi.fn(),
  submitBrainstormNudgeAction: vi.fn(),
}));

beforeEach(() => {
  restartMock.mockClear();
  cleanup();
});

import { RestartButton } from "@/components/brainstorm/restart-button";

describe("RestartButton", () => {
  it("renders the trigger button", () => {
    render(<RestartButton taskId="t1" disabled={false} />);
    expect(screen.getByTestId("restart-button")).toBeInTheDocument();
  });

  it("disables the trigger when disabled prop is true", () => {
    render(<RestartButton taskId="t1" disabled={true} />);
    expect(screen.getByTestId("restart-button")).toBeDisabled();
  });

  it("opens the confirm modal on click", () => {
    render(<RestartButton taskId="t1" disabled={false} />);
    fireEvent.click(screen.getByTestId("restart-button"));
    expect(screen.getByTestId("restart-modal")).toBeInTheDocument();
  });

  it("calls restart action with no note when note is blank", async () => {
    render(<RestartButton taskId="t1" disabled={false} />);
    fireEvent.click(screen.getByTestId("restart-button"));
    fireEvent.click(screen.getByRole("button", { name: /restart brainstorm/i }));
    await waitFor(() => expect(restartMock).toHaveBeenCalledTimes(1));
    expect(restartMock).toHaveBeenCalledWith("t1", undefined);
  });

  it("calls restart action with trimmed note when provided", async () => {
    render(<RestartButton taskId="t1" disabled={false} />);
    fireEvent.click(screen.getByTestId("restart-button"));
    const ta = screen.getByLabelText(/different/i);
    fireEvent.change(ta, { target: { value: "  focus on backend  " } });
    fireEvent.click(screen.getByRole("button", { name: /restart brainstorm/i }));
    await waitFor(() => expect(restartMock).toHaveBeenCalledTimes(1));
    expect(restartMock).toHaveBeenCalledWith("t1", "focus on backend");
  });

  it("Cancel button closes the modal without calling the action", () => {
    render(<RestartButton taskId="t1" disabled={false} />);
    fireEvent.click(screen.getByTestId("restart-button"));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByTestId("restart-modal")).toBeNull();
    expect(restartMock).not.toHaveBeenCalled();
  });
});
