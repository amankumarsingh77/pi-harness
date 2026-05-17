import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Topbar } from "@/components/topbar";

const router = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => router,
}));

const summary = {
  runningCount: 3,
  reviewCount: 2,
  blockedCount: 1,
  costUsd: 1.25,
  costCapUsd: 10,
  lastEventAt: new Date("2026-05-15T10:00:00.000Z"),
  activeRunIds: [],
};

describe("Topbar", () => {
  beforeEach(() => {
    router.push.mockReset();
  });

  it("renders the two-level navigation and focused telemetry", () => {
    render(<Topbar summary={summary} />);

    const strip = screen.getByTestId("topbar-telemetry-strip");
    const cells = within(strip).getAllByTestId("topbar-telemetry-cell");
    expect(cells.map((cell) => cell.getAttribute("data-kind"))).toEqual([
      "running",
      "review",
      "blocked",
    ]);
    expect(screen.getByRole("navigation")).toHaveTextContent("Board");
    expect(screen.getByRole("navigation")).toHaveTextContent("Runs");
    expect(screen.getByRole("navigation")).toHaveTextContent("Scenarios");
    expect(strip).toHaveTextContent("running 3");
    expect(strip).toHaveTextContent("review 2");
    expect(strip).toHaveTextContent("blocked 1");
    expect(screen.queryByText(/Worktrees/i)).not.toBeInTheDocument();
    expect(strip).not.toHaveTextContent(/cost/i);
    expect(strip).not.toHaveTextContent("$1.25 / $10.00");
    expect(strip).not.toHaveTextContent(/last/i);
    expect(screen.queryByText(/done today/i)).not.toBeInTheDocument();
  });

  it("pulses running only when running count is non-zero", () => {
    const { rerender } = render(<Topbar summary={{ ...summary, runningCount: 0 }} />);
    expect(screen.getByTestId("running-dot").className).not.toContain("tick-anim");

    rerender(<Topbar summary={summary} />);
    expect(screen.getByTestId("running-dot").className).toContain("tick-anim");
  });

  it("colors review and blocked values when counts are non-zero", () => {
    render(<Topbar summary={summary} />);
    expect(screen.getByTestId("review-value").className).toContain("text-st-review");
    expect(screen.getByTestId("blocked-value").className).toContain("text-st-blocked");
  });

  it("routes N to the new task page when focus is on the document body", () => {
    render(<Topbar summary={summary} />);
    fireEvent.keyDown(document, { key: "n" });
    expect(router.push).toHaveBeenCalledWith("/tasks/new");
  });
});
