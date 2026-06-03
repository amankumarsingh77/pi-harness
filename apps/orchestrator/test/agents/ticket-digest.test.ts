import { describe, it, expect } from "vitest";
import { buildTicketDigest } from "../../src/agents/ticket-digest.js";

const SHORT_DESIGN = `# Design

## Problem

Canceling an in-flight run currently leaves users without a reliable state transition.

## Context

Runs already emit SSE events and persist phase status.

## Architectural Decisions

- vs immediate kill: graceful is slower but preserves partial state.

## Approaches Considered

- Sigterm-only — rejected because it leaves DB rows in inconsistent state.
`;

const SHORT_SPEC = `# Spec

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
| --- | --- | --- | --- | --- |
| REQ-001 | Event-driven | The system shall cancel an in-flight run. | WHEN POST /api/runs/:id/cancel arrives, run transitions to cancelled within 2s. | Must |
| REQ-002 | Event-driven | The system shall emit cancellation events. | WHEN run is cancelled, SSE phase_cancelled is emitted. | Must |

## Verification scenarios

- WHEN POST /api/runs/:id/cancel arrives, run transitions to cancelled within 2s.
- WHEN run is cancelled, SSE phase_cancelled is emitted.
`;

describe("buildTicketDigest", () => {
  it("includes ticket + Problem + Requirements; omits architectural decision detail", () => {
    const digest = buildTicketDigest({
      ticketTitle: "Add cancel endpoint",
      ticketDescription: "Add /api/runs/:id/cancel.",
      designBody: SHORT_DESIGN,
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("## Add cancel endpoint");
    expect(digest).toContain("leaves users without a reliable state transition");
    expect(digest).toContain("WHEN POST /api/runs/:id/cancel");
    expect(digest).not.toContain("vs immediate kill");
    expect(digest).not.toContain("Sigterm-only");
    expect(digest).toContain("Full context (read on demand)");
  });

  it("falls back gracefully when Problem is missing", () => {
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: "# Design\n\n## Context\n\nfoo\n",
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("## X");
    expect(digest).toContain("Y");
    expect(digest).not.toContain("# Problem (from design.md)");
    expect(digest).toContain("# Requirements (from spec.md)");
  });

  it("falls back gracefully when Requirements is missing", () => {
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: SHORT_DESIGN,
      specBody: "# Spec\n\n## Verification scenarios\n\nfoo\n",
    });
    expect(digest).toContain("# Problem (from design.md)");
    expect(digest).not.toContain("# Requirements (from spec.md)");
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
    expect(digest).not.toContain("# Problem");
    expect(digest).not.toContain("# Requirements");
    expect(digest).toContain("Full context");
  });

  it("does not bleed past the section's H2 boundary", () => {
    const design = `## Problem\n\nPROBLEM_BODY\n\n## Context\n\nCONTEXT_BODY\n`;
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: design,
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("PROBLEM_BODY");
    expect(digest).not.toContain("CONTEXT_BODY");
  });

  it("truncates abnormally long sections with an ellipsis marker", () => {
    const huge = "x".repeat(3000);
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: `## Problem\n\n${huge}\n`,
      specBody: SHORT_SPEC,
    });
    expect(digest).toContain("…(truncated for digest");
    expect(digest.length).toBeLessThan(huge.length);
  });

  it("ignores an empty Problem section (whitespace-only body)", () => {
    const design = `## Problem\n\n   \n\n## Context\n\nfoo\n`;
    const digest = buildTicketDigest({
      ticketTitle: "X",
      ticketDescription: "Y",
      designBody: design,
      specBody: SHORT_SPEC,
    });
    expect(digest).not.toContain("# Problem (from design.md)");
  });
});
