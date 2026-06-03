import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceColumn } from "@/components/verify/evidence-column";
import { VerdictStrip } from "@/components/verify/verdict-strip";

describe("EvidenceColumn", () => {
  it("renders the given title and count", () => {
    render(<EvidenceColumn title="UNIT + INTEGRATION" passed={24} total={24}>{null}</EvidenceColumn>);
    expect(screen.getByText("24 / 24")).toBeInTheDocument();
    expect(screen.getByText(/UNIT/)).toBeInTheDocument();
  });

  it("renders an arbitrary scenario-type title (not a fixed set)", () => {
    render(<EvidenceColumn title="DB" passed={1} total={2}>{null}</EvidenceColumn>);
    expect(screen.getByText("DB")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("labels zero-total evidence as not applicable instead of a pass count", () => {
    render(<EvidenceColumn title="UNIT + INTEGRATION" passed={0} total={0}>{null}</EvidenceColumn>);
    expect(screen.getByText("not applicable")).toBeInTheDocument();
  });

  it("amber accent while capturing (in-flight evidence)", () => {
    const { container } = render(<EvidenceColumn title="UI" passed={0} total={3} capturing>{null}</EvidenceColumn>);
    // Amber accent is encoded as the RGBA(251,191,36,…) Tailwind arbitrary
    // gradient on the header — that's the only DOM-visible signal that the
    // capturing-amber branch was hit.
    expect((container.firstChild as HTMLElement | null)?.className).toMatch(/251,191,36/);
  });
});

describe("VerdictStrip", () => {
  it("counts green classes over a dynamic class list", () => {
    render(
      <VerdictStrip
        classes={[
          { label: "unit", passed: 4, total: 4 },
          { label: "ui", passed: 1, total: 2 },
          { label: "db", passed: 3, total: 3 },
        ]}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument(); // total classes (the <em>)
    expect(screen.getByText(/waiting on 1 evidence class/)).toBeInTheDocument();
    expect(screen.getByText(/unit 4\/4 · ui 1\/2 · db 3\/3/)).toBeInTheDocument();
  });

  it("unlocks when every class is green", () => {
    render(
      <VerdictStrip classes={[{ label: "unit", passed: 2, total: 2 }, { label: "api", passed: 1, total: 1 }]} />,
    );
    expect(screen.getByText(/All 2 evidence classes green · PR creation unlocked/)).toBeInTheDocument();
  });

  it("keeps 0/0 classes out of the green count and summary total", () => {
    render(
      <VerdictStrip
        classes={[
          { label: "unit", passed: 0, total: 0 },
          { label: "ui", passed: 1, total: 1 },
        ]}
      />,
    );
    expect(screen.getByText(/All 1 evidence class green/)).toBeInTheDocument();
    expect(screen.getByText(/unit n\/a · ui 1\/1/)).toBeInTheDocument();
  });

  it("explains when every evidence class is not applicable", () => {
    render(
      <VerdictStrip
        classes={[
          { label: "unit", passed: 0, total: 0 },
          { label: "ui", passed: 0, total: 0 },
        ]}
      />,
    );

    expect(screen.getByText("No applicable evidence classes yet")).toBeInTheDocument();
    expect(screen.getByText(/n\/a classes are intentionally excluded/)).toBeInTheDocument();
  });
});
