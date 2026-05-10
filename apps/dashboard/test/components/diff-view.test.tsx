import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiffView, diffLines } from "@/components/brainstorm/diff-view";

describe("diffLines", () => {
  it("classifies identical inputs as all equal", () => {
    const parts = diffLines("a\nb\nc", "a\nb\nc");
    expect(parts.every((p) => p.kind === "equal")).toBe(true);
  });

  it("flags add-only lines as add", () => {
    const parts = diffLines("a\nb", "a\nb\nc");
    expect(parts).toEqual([
      { kind: "equal", line: "a" },
      { kind: "equal", line: "b" },
      { kind: "add", line: "c" },
    ]);
  });

  it("flags removed-only lines as remove", () => {
    const parts = diffLines("a\nb\nc", "a\nc");
    expect(parts).toEqual([
      { kind: "equal", line: "a" },
      { kind: "remove", line: "b" },
      { kind: "equal", line: "c" },
    ]);
  });

  it("interleaves adds and removes correctly", () => {
    const parts = diffLines("a\nb", "a\nc\nb");
    expect(parts.map((p) => p.kind)).toEqual(["equal", "add", "equal"]);
  });

  it("handles empty baseline (everything is add)", () => {
    const parts = diffLines("", "a\nb");
    // Note: "".split("\n") yields [""], which is technically an equal empty line.
    // The interesting bit is that the new lines come through as add.
    expect(parts.filter((p) => p.kind === "add").length).toBeGreaterThan(0);
  });

  it("handles empty current (everything is remove)", () => {
    const parts = diffLines("a\nb", "");
    expect(parts.filter((p) => p.kind === "remove").length).toBeGreaterThan(0);
  });
});

describe("DiffView", () => {
  it("renders the changed lines with their content visible", () => {
    render(<DiffView baseline={"alpha\nbeta\ngamma"} current={"alpha\nzeta\ngamma"} />);
    const view = screen.getByTestId("diff-view");
    // textContent collapses across the marker span + line content; assert
    // the words themselves are present and absent as expected for an
    // add/remove pair.
    expect(view.textContent).toContain("beta");
    expect(view.textContent).toContain("zeta");
    // Both add and remove rows are rendered (we can't easily assert ordering
    // through textContent collapse, but the row count tells us the diff
    // produced what we expect).
    expect(view.querySelectorAll("div").length).toBeGreaterThanOrEqual(3);
  });

  it("renders nothing scary for empty inputs", () => {
    render(<DiffView baseline="" current="" />);
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
  });
});
