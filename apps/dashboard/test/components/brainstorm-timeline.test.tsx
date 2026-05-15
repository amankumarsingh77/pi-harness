import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AgentEvent } from "@pi-harness/shared";
import type { BrainstormJsonlEvent } from "@/lib/api";
import {
  mergeEvents,
  projectAgentEvent,
  useBrainstormTimeline,
} from "@/components/brainstorm/use-brainstorm-timeline";

const baseAgent = {
  id: "e1",
  runId: "r1",
  taskId: "t1",
  ts: new Date("2026-05-15T10:00:00.000Z"),
};

describe("useBrainstormTimeline", () => {
  it("merges live events, derives one pending batch, and pins blocked events", () => {
    const initial: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_question",
        ts: "2026-05-15T10:00:00.000Z",
        questionId: "Q1",
        prompt: "Where should the rail live?",
        options: [{ id: "left", label: "Left", recommended: true, evidence: [] }],
        sectionTarget: { artifact: "design", section: "Layout" },
        batchId: "b1",
      },
      {
        kind: "brainstorm_system",
        ts: "2026-05-15T10:00:02.000Z",
        systemKind: "blocked",
        data: { reason: "max turns" },
      },
    ];
    const live: AgentEvent[] = [
      {
        ...baseAgent,
        id: "usage",
        kind: "brainstorm_usage",
        tickIndex: 1,
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.1,
        cumulativeInputTokens: 10,
        cumulativeOutputTokens: 20,
        cumulativeCostUsd: 0.1,
      },
    ];

    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: initial,
        liveEvents: live,
        connected: true,
        taskStatus: "brainstorming",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    expect(result.current.pendingBatch?.batchId).toBe("b1");
    expect(result.current.pinnedBlocked?.systemKind).toBe("blocked");
    expect(result.current.usage.costUsd).toBe(0.1);
    expect(result.current.health).toBe("live");
  });

  it("keeps latest mock revision, selected mock, nudge state, and artifact anchors", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:00.000Z",
        mock: mock("mock-a", "Original"),
      },
      {
        kind: "brainstorm_mock_revised",
        ts: "2026-05-15T10:00:01.000Z",
        editRequestId: "mer_1",
        mock: mock("mock-a", "Revised"),
      },
      {
        kind: "brainstorm_mock_selected",
        ts: "2026-05-15T10:00:02.000Z",
        mockId: "mock-a",
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-15T10:00:03.000Z",
        nudgeId: "n1",
        comment: "Try another direction",
        consumed: false,
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-15T10:00:04.000Z",
        nudgeId: "n1",
        comment: "Try another direction",
        consumed: true,
      },
      {
        kind: "brainstorm_artifact_edited",
        ts: "2026-05-15T10:00:05.000Z",
        artifact: "design",
        commitSha: "abc123",
        sizeDelta: 12,
      },
    ];

    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: events,
        liveEvents: [],
        connected: true,
        taskStatus: "brainstorming",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    expect(result.current.mocks).toHaveLength(1);
    expect(result.current.mocks[0]?.mock.title).toBe("Revised");
    expect(result.current.chosenMockId).toBe("mock-a");
    expect(result.current.nudgeSummary.latest?.consumed).toBe(true);
    expect(result.current.nudgeSummary.inFlightCount).toBe(0);
    expect(result.current.artifactAnchors.get("design")?.commitSha).toBe("abc123");
  });

  it("shows only the latest explicit mock set as active choices", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:00.000Z",
        mockSetId: "mset_1",
        mock: mock("mock-a", "Original A"),
      },
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:01.000Z",
        mockSetId: "mset_1",
        mock: mock("mock-b", "Original B"),
      },
      {
        kind: "brainstorm_mock_selected",
        ts: "2026-05-15T10:00:02.000Z",
        mockId: "mock-a",
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-15T10:00:03.000Z",
        nudgeId: "n1",
        comment: "Try sharper alternatives",
        consumed: true,
      },
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:04.000Z",
        mockSetId: "mset_2",
        mock: mock("mock-c", "New C"),
      },
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:05.000Z",
        mockSetId: "mset_2",
        mock: mock("mock-d", "New D"),
      },
    ];

    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: events,
        liveEvents: [],
        connected: true,
        taskStatus: "brainstorming",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    expect(result.current.mocks.map((entry) => entry.mock.mockId)).toEqual(["mock-c", "mock-d"]);
    expect(result.current.mocks.every((entry) => entry.dimmed === false)).toBe(true);
    expect(result.current.focusItems.filter((item) => item.kind === "mocks")).toHaveLength(1);
  });

  it("treats legacy contiguous proposal groups as separate active mock sets", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:00.000Z",
        mock: mock("mock-a", "Original A"),
      },
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:01.000Z",
        mock: mock("mock-b", "Original B"),
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-15T10:00:02.000Z",
        nudgeId: "n1",
        comment: "Try sharper alternatives",
        consumed: true,
      },
      {
        kind: "brainstorm_mock_proposed",
        ts: "2026-05-15T10:00:03.000Z",
        mock: mock("mock-c", "New C"),
      },
    ];

    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: events,
        liveEvents: [],
        connected: true,
        taskStatus: "brainstorming",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    expect(result.current.mocks.map((entry) => entry.mock.mockId)).toEqual(["mock-c"]);
  });

  it("keeps generic tool logs in the rail and answered questions in chronological focus history", () => {
    const events: BrainstormJsonlEvent[] = [
      {
        kind: "brainstorm_question",
        ts: "2026-05-15T10:00:00.000Z",
        questionId: "Q1",
        prompt: "Where should nudges live?",
        options: [{ id: "composer", label: "Above composer", recommended: true, evidence: [] }],
        sectionTarget: { artifact: "design", section: "Interaction" },
        batchId: "b1",
      },
      {
        kind: "brainstorm_answer",
        ts: "2026-05-15T10:00:01.000Z",
        questionId: "Q1",
        optionId: "composer",
      },
      {
        kind: "brainstorm_user_nudge",
        ts: "2026-05-15T10:00:02.000Z",
        nudgeId: "n1",
        comment: "Keep this queued above the input",
        consumed: false,
      },
      {
        kind: "brainstorm_agent_reply",
        ts: "2026-05-15T10:00:03.000Z",
        replyId: "r1",
        message: "Noted.",
        inReplyToNudgeId: "n1",
      },
    ];
    const initialAgentEvents: AgentEvent[] = [
      {
        ...baseAgent,
        id: "tool-1",
        ts: new Date("2026-05-15T10:00:01.500Z"),
        kind: "tool_call",
        tool: "write",
        input: { path: ".harness/t1/design.md" },
      },
      {
        ...baseAgent,
        id: "log-1",
        ts: new Date("2026-05-15T10:00:01.750Z"),
        kind: "log",
        level: "info",
        text: "write() finished",
      },
      {
        ...baseAgent,
        id: "delta-1",
        ts: new Date("2026-05-15T10:00:02.100Z"),
        kind: "message_delta",
        text: "expand",
      },
      {
        ...baseAgent,
        id: "delta-2",
        ts: new Date("2026-05-15T10:00:02.200Z"),
        kind: "message_delta",
        text: "able",
      },
      {
        ...baseAgent,
        id: "delta-3",
        ts: new Date("2026-05-15T10:00:02.300Z"),
        kind: "message_delta",
        text: "tool",
      },
    ];

    const { result } = renderHook(() =>
      useBrainstormTimeline({
        initialEvents: events,
        initialAgentEvents,
        liveEvents: [],
        connected: true,
        taskStatus: "brainstorming",
        gate: "running",
        runId: "r1",
        nowMs: Date.now(),
      }),
    );

    expect(result.current.railRows.some((row) => row.label.includes("tool · write"))).toBe(true);
    expect(result.current.railRows.some((row) => row.label.includes("info: write() finished"))).toBe(true);
    expect(result.current.railRows.filter((row) => row.tone === "message")).toHaveLength(1);
    expect(result.current.railRows.some((row) => row.label === "agent stream · 3 chunks")).toBe(true);
    expect(result.current.railRows.some((row) => row.label === "agent stream: expand")).toBe(false);
    expect(result.current.focusItems.map((item) => item.kind)).toEqual(["questions", "nudge"]);
    expect(result.current.questionThreads[0]?.state).toBe("answered");
    expect(result.current.nudgeThreads[0]?.status).toBe("replied");
  });
});

describe("brainstorm event projection", () => {
  it("dedupes equivalent question events from server and SSE", () => {
    const question: BrainstormJsonlEvent = {
      kind: "brainstorm_question",
      ts: "2026-05-15T10:00:00.000Z",
      questionId: "Q1",
      prompt: "Pick",
      options: [{ id: "a", label: "A", recommended: true, evidence: [] }],
      sectionTarget: { artifact: "spec", section: "Acceptance" },
      batchId: "b1",
    };
    const projected = projectAgentEvent({
      ...baseAgent,
      kind: "brainstorm_question",
      questionId: "Q1",
      prompt: "Pick",
      options: [{ id: "a", label: "A", recommended: true, evidence: [] }],
      sectionTarget: { artifact: "spec", section: "Acceptance" },
      batchId: "b1",
    });

    expect(projected).not.toBeNull();
    expect(mergeEvents([question], projected ? [projected] : [])).toHaveLength(1);
  });
});

function mock(mockId: string, title: string) {
  return {
    mockId,
    title,
    summary: "Summary",
    recommended: false,
    createdAt: "2026-05-15T10:00:00.000Z",
    pages: [{ pageId: "home", title: "Home", htmlPath: ".harness/t1/mocks/mock-a/home.html" }],
  };
}
