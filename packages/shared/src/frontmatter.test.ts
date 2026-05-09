import { describe, it, expect } from "vitest";
import { parseArtifact, stringifyArtifact } from "./frontmatter.js";
import type { Artifact } from "./types/artifact.js";

const sample: Artifact = {
  fm: {
    task: "T-001",
    kind: "design",
    parent: null,
    status: "draft",
    branch: "pi/T-001",
    last_updated: "2026-05-09T12:00:00.000Z",
    last_updated_by: "orchestrator",
  },
  body: "# Design\n\nbody content here\n",
};

describe("parseArtifact / stringifyArtifact", () => {
  it("round-trips frontmatter and body", () => {
    const raw = stringifyArtifact(sample);
    const parsed = parseArtifact(raw);
    expect(parsed.fm).toEqual(sample.fm);
    expect(parsed.body.trim()).toBe(sample.body.trim());
  });

  it("rejects unknown status values", () => {
    const bad = `---\ntask: T-1\nkind: design\nparent: null\nstatus: bogus\nbranch: x\nlast_updated: 2026-05-09T12:00:00.000Z\nlast_updated_by: x\n---\nbody`;
    expect(() => parseArtifact(bad)).toThrow();
  });

  it("rejects missing required fields", () => {
    const bad = `---\ntask: T-1\nkind: design\n---\nbody`;
    expect(() => parseArtifact(bad)).toThrow();
  });

  it("preserves status changes through round-trip", () => {
    const ready: Artifact = { ...sample, fm: { ...sample.fm, status: "ready" } };
    const raw = stringifyArtifact(ready);
    expect(parseArtifact(raw).fm.status).toBe("ready");
  });

  it("supports parent path on spec artifacts", () => {
    const spec: Artifact = {
      fm: { ...sample.fm, kind: "spec", parent: "design.md" },
      body: "# Spec\n",
    };
    const raw = stringifyArtifact(spec);
    expect(parseArtifact(raw).fm.parent).toBe("design.md");
  });
});
