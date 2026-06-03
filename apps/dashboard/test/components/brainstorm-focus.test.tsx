import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { BrainstormJsonlEvent } from "@/lib/api";
import { FocusStage } from "@/components/brainstorm/focus-stage";
import { useBrainstormTimeline } from "@/components/brainstorm/use-brainstorm-timeline";

vi.mock("@/app/tasks/[id]/actions", () => ({
  submitBrainstormNudgeAction: vi.fn(),
  submitBrainstormAnswersAction: vi.fn(),
  submitBrainstormMockEditAction: vi.fn(),
  selectBrainstormMockAction: vi.fn(),
}));

describe("FocusStage", () => {
  it("keeps answered questions visible and renders queued nudges above the input", () => {
    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: [
          question(),
          {
            kind: "brainstorm_answer",
            ts: "2026-05-15T10:00:01.000Z",
            questionId: "Q1",
            optionId: "composer",
          },
          {
            kind: "brainstorm_user_nudge",
            ts: "2026-05-15T10:00:02.000Z",
            nudgeId: "n1",
            comment: "Queue this without covering the view",
            consumed: false,
          },
        ],
        liveEvents: [],
        connected: true,
        taskStatus: "brainstorming",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    render(<FocusStage taskId="t1" taskStatus="brainstorming" timeline={result.current} />);

    expect(screen.getByText("Where should queued nudges appear?")).toBeInTheDocument();
    expect(screen.getByText("Above composer input")).toBeInTheDocument();
    expect(screen.getByTestId("nudge-thread").textContent).toContain(
      "Queue this without covering the view",
    );

    const shelf = screen.getByTestId("queued-nudge-shelf");
    const input = screen.getByLabelText(/nudge the agent/i);
    expect(shelf.textContent).toContain("queued");
    expect(shelf.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("puts restart recovery next to a failed brainstorm", () => {
    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: [
          {
            kind: "brainstorm_system",
            ts: "2026-05-15T10:00:00.000Z",
            systemKind: "status_changed",
            data: { status: "failed", reason: "graphify initialization failed" },
          },
        ],
        liveEvents: [],
        connected: true,
        taskStatus: "brainstorm_failed",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    render(<FocusStage taskId="t1" taskStatus="brainstorm_failed" timeline={result.current} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Brainstorm failed");
    expect(screen.getByRole("button", { name: "Restart brainstorm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View full error" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostic" })).toBeInTheDocument();
    expect(screen.getByText(/graphify initialization failed/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View full error" }));
    expect(screen.getByText(/eventCount/)).toBeInTheDocument();
  });
});

function question(): BrainstormJsonlEvent {
  return {
    kind: "brainstorm_question",
    ts: "2026-05-15T10:00:00.000Z",
    questionId: "Q1",
    prompt: "Where should queued nudges appear?",
    options: [
      {
        id: "composer",
        label: "Above composer input",
        recommended: true,
        evidence: [],
      },
    ],
    sectionTarget: { artifact: "design", section: "Nudges" },
    batchId: "b1",
  };
}
