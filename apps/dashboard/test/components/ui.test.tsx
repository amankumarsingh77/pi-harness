import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";

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
});
