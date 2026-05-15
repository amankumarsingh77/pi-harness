import { describe, it, expect } from "vitest";
import type { AgentEvent } from "./event.js";

// Compile-time + runtime smoke that each new plan_* variant is constructible
// and discriminates correctly on `kind`. The union has no Zod mirror so this
// is the only place wrong field shapes would surface before downstream code
// breaks.

const base = {
  id: "e1",
  runId: "r1",
  taskId: "T-001",
  ts: new Date(0),
};

describe("plan_* AgentEvent variants", () => {
  it("plan_system narrows by kind", () => {
    const e: AgentEvent = {
      ...base,
      kind: "plan_system",
      systemKind: "preflight_complete",
      data: { count: 8 },
    };
    if (e.kind === "plan_system") {
      expect(e.systemKind).toBe("preflight_complete");
    } else {
      expect.fail("expected plan_system");
    }
  });

  it("plan_subagent_started carries subagent + sessionId", () => {
    const e: AgentEvent = {
      ...base,
      kind: "plan_subagent_started",
      subagent: "codebase-locator",
      sessionId: "s-1",
    };
    if (e.kind === "plan_subagent_started") {
      expect(e.subagent).toBe("codebase-locator");
    } else {
      expect.fail("expected plan_subagent_started");
    }
  });

  it("plan_subagent_ended carries usage + ok flag", () => {
    const e: AgentEvent = {
      ...base,
      kind: "plan_subagent_ended",
      subagent: "codebase-locator",
      sessionId: "s-2",
      ok: true,
      durationMs: 1234,
      costUsd: 0.05,
      inputTokens: 100,
      outputTokens: 200,
    };
    if (e.kind === "plan_subagent_ended") {
      expect(e.ok).toBe(true);
      expect(e.costUsd).toBe(0.05);
    } else {
      expect.fail("expected plan_subagent_ended");
    }
  });

  it("plan_revision_requested carries comment", () => {
    const e: AgentEvent = {
      ...base,
      kind: "plan_revision_requested",
      comment: "tighten scope",
    };
    if (e.kind === "plan_revision_requested") {
      expect(e.comment).toBe("tighten scope");
    } else {
      expect.fail("expected plan_revision_requested");
    }
  });

  it("plan_usage carries cumulative + per-tick fields", () => {
    const e: AgentEvent = {
      ...base,
      kind: "plan_usage",
      tickIndex: 2,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0.01,
      cumulativeInputTokens: 100,
      cumulativeOutputTokens: 200,
      cumulativeCostUsd: 0.5,
    };
    if (e.kind === "plan_usage") {
      expect(e.tickIndex).toBe(2);
      expect(e.cumulativeCostUsd).toBe(0.5);
    } else {
      expect.fail("expected plan_usage");
    }
  });

  it("plan_artifact_edited tags artifact + commit sha", () => {
    const e: AgentEvent = {
      ...base,
      kind: "plan_artifact_edited",
      artifact: "scenarios",
      commitSha: "abc123",
      sizeDelta: 42,
    };
    if (e.kind === "plan_artifact_edited") {
      expect(e.artifact).toBe("scenarios");
    } else {
      expect.fail("expected plan_artifact_edited");
    }
  });
});

describe("brainstorm mock AgentEvent variants", () => {
  it("brainstorm_mock_proposed carries the mock card fields", () => {
    const e: AgentEvent = {
      ...base,
      kind: "brainstorm_mock_proposed",
      mock: {
        mockId: "mock-a",
        title: "Split pane review",
        summary: "Keeps choices beside the emerging artifacts.",
        recommended: true,
        createdAt: "2026-05-13T00:00:00.000Z",
        miniature: {
          kind: "rows",
          rows: [
            { status: "fail", label: "phase rail spacing", action: "promote" },
            { status: "pass", label: "artifact links" },
          ],
        },
        pages: [
          {
            pageId: "task-detail",
            title: "Task detail",
            htmlPath: ".harness/T-001/mocks/mock-a/task-detail.html",
          },
        ],
      },
    };
    if (e.kind === "brainstorm_mock_proposed") {
      expect(e.mock.mockId).toBe("mock-a");
      expect(e.mock.recommended).toBe(true);
      expect(e.mock.miniature?.kind).toBe("rows");
    } else {
      expect.fail("expected brainstorm_mock_proposed");
    }
  });

  it("brainstorm_mock_revised carries lineage to the source mock", () => {
    const e: AgentEvent = {
      ...base,
      kind: "brainstorm_mock_revised",
      mock: {
        mockId: "mock-a-rev1",
        title: "Split pane review refined",
        summary: "Narrows the artifact pane.",
        recommended: false,
        derivedFrom: "mock-a",
        createdAt: "2026-05-13T00:00:00.000Z",
        pages: [
          {
            pageId: "task-detail",
            title: "Task detail",
            htmlPath: ".harness/T-001/mocks/mock-a-rev1/task-detail.html",
          },
        ],
      },
      editRequestId: "mer_1",
    };
    if (e.kind === "brainstorm_mock_revised") {
      expect(e.mock.derivedFrom).toBe("mock-a");
      expect(e.editRequestId).toBe("mer_1");
    } else {
      expect.fail("expected brainstorm_mock_revised");
    }
  });

  it("brainstorm_mock_selected records the chosen mock", () => {
    const e: AgentEvent = {
      ...base,
      kind: "brainstorm_mock_selected",
      mockId: "mock-a-rev1",
    };
    if (e.kind === "brainstorm_mock_selected") {
      expect(e.mockId).toBe("mock-a-rev1");
    } else {
      expect.fail("expected brainstorm_mock_selected");
    }
  });

  it("brainstorm_mock_edit_requested carries a requested change", () => {
    const e: AgentEvent = {
      ...base,
      kind: "brainstorm_mock_edit_requested",
      requestId: "mer_1",
      mockId: "mock-a",
      comment: "Make the artifact pane narrower.",
    };
    if (e.kind === "brainstorm_mock_edit_requested") {
      expect(e.comment).toContain("narrower");
    } else {
      expect.fail("expected brainstorm_mock_edit_requested");
    }
  });
});
