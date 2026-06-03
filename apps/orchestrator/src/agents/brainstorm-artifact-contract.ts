import type { ArtifactKind } from "@pi-harness/shared";

export type BrainstormArtifactKind = Extract<ArtifactKind, "design" | "spec">;

export const BRAINSTORM_REQUIRED_SECTIONS: Record<BrainstormArtifactKind, readonly string[]> = {
  design: [
    "## Problem",
    "## Context",
    "## Requirements",
    "## Architectural Decisions",
    "## Approaches Considered",
    "## Data Shapes / Contracts",
    "## Architecture",
    "## External Dependencies & Fallback Chain",
    "## Risks & Mitigations",
    "## Assumptions",
    "## Open Questions",
    "## What This Does NOT Do",
  ],
  spec: [
    "## Glossary",
    "## Requirements",
    "## Edge Cases",
    "## Verification Matrix",
    "## Verification scenarios",
    "## Out of Scope",
  ],
};

function scaffoldBody(title: string, sections: readonly string[]): string {
  return [`# ${title}`, "", ...sections.flatMap((section) => [section, ""]), ""].join("\n");
}

export function scaffoldBrainstormBody(kind: BrainstormArtifactKind): string {
  return scaffoldBody(kind === "design" ? "Design" : "Spec", BRAINSTORM_REQUIRED_SECTIONS[kind]);
}
