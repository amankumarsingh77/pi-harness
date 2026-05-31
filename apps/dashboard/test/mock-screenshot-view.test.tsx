import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MockScreenshotView } from "../components/brainstorm/mock-screenshot-view";

describe("MockScreenshotView", () => {
  it("shows the desktop screenshot by default and switches to mobile", () => {
    render(
      <MockScreenshotView title="Settings" desktopSrc="/png/desktop" mobileSrc="/png/mobile" />,
    );
    const img = screen.getByRole("img", { name: /Settings/ }) as HTMLImageElement;
    expect(img.src).toContain("/png/desktop");
    fireEvent.click(screen.getByRole("button", { name: /mobile/i }));
    expect((screen.getByRole("img", { name: /Settings/ }) as HTMLImageElement).src).toContain("/png/mobile");
  });
});
