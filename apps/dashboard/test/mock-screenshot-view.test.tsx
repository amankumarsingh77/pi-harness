import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MockHtmlPreview } from "../components/brainstorm/mock-screenshot-view";

describe("MockHtmlPreview", () => {
  it("shows live desktop HTML by default and switches to a mobile viewport", () => {
    const { container } = render(
      <MockHtmlPreview title="Settings" htmlSrc="/mock/html" />,
    );
    const frame = screen.getByTitle(/Settings/) as HTMLIFrameElement;
    expect(frame.src).toContain("/mock/html");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.parentElement?.className).toContain("w-[1280px]");
    expect(frame.parentElement?.className).not.toContain("bg-white");
    expect(container.querySelector("[data-mock-preview-scroll]")?.className).not.toContain("bg-white");
    fireEvent.click(screen.getByRole("button", { name: /mobile/i }));
    expect(frame.parentElement?.className).toContain("w-[390px]");
  });
});
