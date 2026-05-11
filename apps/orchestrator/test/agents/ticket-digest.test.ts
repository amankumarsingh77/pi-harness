import { describe, it, expect } from "vitest";
import { buildTicketDigest } from "../../src/agents/ticket-digest.js";

const SHORT_DESIGN = `# Design

## Goals

- Cancel an in-flight run cleanly.
- Emit phase_cancelled SSE event.

## Trade-offs

- vs immediate kill: graceful is slower but preserves partial state.

## Alternatives considered

- Sigterm-only — rejected because it leaves DB rows in inconsistent state.
`;

const SHORT_SPEC = `# Spec

## Verification scenarios

- Cancel mid-brainstorm.

## Acceptance criteria

- WHEN POST /api/runs/:id/cancel arrives, run transitions to cancelled within 2s.
- WHEN run is cancelled, SSE phase_cancelled is emitted.
`;

describe("buildTicketDigest", () => {
  it("includes ticket + Goals + Acceptance criteria; omits Trade-offs and Alternatives", () => {
    const digest = buildTicketDigest({
      ticketTitle: "Add cancel endpoint",
      ticketDescription: "Add /api/runs/:id/cancel.",
      designBody: SHORT_DESIGN,
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("## Add cancel endpoint");
    expect(digest).toContain("Cancel an in-flight run cleanly");
    expect(digest).toContain("WHEN POST /api/runs/:id/cancel");
    expect(digest).not.toContain("vs immediate kill");
    expect(digest).not.toContain("Sigterm-only");
    expect(digest).toContain("Full context (read on demand)");
  });

  it("falls back gracefully when Goals is missing", () => {
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: "# Design\n\n## Trade-offs\n\nfoo\n",
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("## X");
    expect(digest).toContain("Y");
    expect(digest).not.toContain("# Goals (from design.md)");
    expect(digest).toContain("# Acceptance criteria (from spec.md)");
  });

  it("falls back gracefully when Acceptance criteria is missing", () => {
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: SHORT_DESIGN,
      specBody: "# Spec\n\n## Verification scenarios\n\nfoo\n",
    });
    expect(digest).toContain("# Goals (from design.md)");
    expect(digest).not.toContain("# Acceptance criteria (from spec.md)");
  });

  it("works when both sections are missing — emits ticket-only digest", () => {
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: "# Design\n\nno H2 sections\n",
      specBody: "# Spec\n\nno H2 sections\n",
    });
    expect(digest).toContain("## X");
    expect(digest).toContain("Y");
    expect(digest).not.toContain("# Goals");
    expect(digest).not.toContain("# Acceptance criteria");
    expect(digest).toContain("Full context");
  });

  it("does not bleed past the section's H2 boundary", () => {
    const design = `## Goals\n\nGOAL_BODY\n\n## Trade-offs\n\nTRADEOFF_BODY\n`;
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: design,
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("GOAL_BODY");
    expect(digest).not.toContain("TRADEOFF_BODY");
  });

  it("truncates abnormally long sections with an ellipsis marker", () => {
    const huge = "x".repeat(3000);
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: `## Goals\n\n${huge}\n`,
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("…(truncated for digest");
    expect(digest.length).toBeLessThan(huge.length);
  });

  it("ignores an empty Goals section (whitespace-only body)", () => {
    const design = `## Goals\n\n   \n\n## Trade-offs\n\nfoo\n`;
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: design,
      specBody: SHORT_SPEC,
    });
    expect(digest).not.toContain("# Goals (from design.md)");
  });
});
