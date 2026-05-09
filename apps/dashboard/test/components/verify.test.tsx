import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EvidenceColumn } from "@/components/verify/evidence-column";

describe("EvidenceColumn", () => {
  it("renders header with count", () => {
    render(<EvidenceColumn type="unit" passed={24} total={24}>{null}</EvidenceColumn>);
    expect(screen.getByText("24 / 24")).toBeInTheDocument();
    expect(screen.getByText(/UNIT/)).toBeInTheDocument();
  });

  it("amber accent while capturing (in-flight visual evidence)", () => {
    const { container } = render(<EvidenceColumn type="visual" passed={0} total={3} capturing>{null}</EvidenceColumn>);
    // Amber accent is encoded as the RGBA(251,191,36,…) Tailwind arbitrary
    // gradient on the header — that's the only DOM-visible signal that the
    // capturing-amber branch was hit.
    expect((container.firstChild as HTMLElement | null)?.className).toMatch(/251,191,36/);
  });
});
