import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { DesignSystemEmptyState } from "@/components/design/design-system-view";
import RootNotFound from "@/app/not-found";

describe("Pill", () => {
  it("renders semantic color via accent prop", () => {
    const { container } = render(<Pill accent="amber">task 4 of 9</Pill>);
    expect(screen.getByText("task 4 of 9")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("bg-amber-bg");
  });
  it("renders pulse-dot when live=true", () => {
    const { container } = render(<Pill accent="violet" live>awaiting human</Pill>);
    expect(container.querySelector(".pulse-dot")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("default is white-on-black", () => {
    const { container } = render(<Button>Approve</Button>);
    expect(container.firstChild).toHaveClass("bg-fg");
    expect(container.firstChild).toHaveClass("text-bg");
  });
  it("danger variant uses red tokens", () => {
    const { container } = render(<Button variant="danger">Stop</Button>);
    expect((container.firstChild as HTMLElement | null)?.className).toMatch(/red/);
  });

  it("renders a leading icon when provided", () => {
    render(<Button icon={<span data-testid="button-icon" />}>Restart</Button>);
    expect(screen.getByTestId("button-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart" })).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("pairs a status label with a semantic tone", () => {
    render(<StatusBadge tone="blocked">blocked</StatusBadge>);
    const badge = screen.getByText("blocked");
    expect(badge).toHaveClass("text-st-blocked");
  });
});

describe("EmptyState", () => {
  it("renders title, body, and action content as one purposeful region", () => {
    render(
      <EmptyState
        title="No execution DAG authored"
        body="Plan approval writes execution-dag.yaml before code starts."
        action={<Button>Open plan</Button>}
      />,
    );
    expect(screen.getByRole("region", { name: "No execution DAG authored" })).toBeInTheDocument();
    expect(screen.getByText("Plan approval writes execution-dag.yaml before code starts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open plan" })).toBeInTheDocument();
  });
});

describe("Alert", () => {
  it("renders recovery copy and action content", () => {
    render(
      <Alert tone="danger" title="Brainstorm failed" action={<Button variant="danger">Restart brainstorm</Button>}>
        Restart the phase after reviewing the diagnostic.
      </Alert>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Brainstorm failed");
    expect(screen.getByRole("button", { name: "Restart brainstorm" })).toBeInTheDocument();
  });
});

describe("Route empty states", () => {
  it("renders a design-system setup state with a concrete next action", () => {
    render(<DesignSystemEmptyState />);
    expect(screen.getByRole("region", { name: "Design system not seeded" })).toBeInTheDocument();
    expect(screen.getByText(/Promote a brainstorm mock/)).toBeInTheDocument();
  });

  it("renders 404 recovery links into the app", () => {
    render(<RootNotFound />);
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("link", { name: "New task" })).toHaveAttribute("href", "/tasks/new");
  });
});
