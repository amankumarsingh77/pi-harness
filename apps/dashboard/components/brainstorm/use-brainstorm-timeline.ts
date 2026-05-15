"use client";

import { useMemo } from "react";
import type { AgentEvent, BrainstormMock, TaskStatus } from "@pi-harness/shared";
import type { BrainstormGate, BrainstormJsonlEvent } from "@/lib/api";
import { deriveActivity, type ActivityState } from "./activity-line";

export type QuestionEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }>;
export type AnswerEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_answer" }>;
export type NudgeEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_user_nudge" }>;
export type AgentReplyEvent = Extract<
  BrainstormJsonlEvent,
  { kind: "brainstorm_agent_reply" }
>;
export type RevisionEvent = Extract<
  BrainstormJsonlEvent,
  { kind: "brainstorm_revision_requested" }
>;
export type ArtifactEditEvent = Extract<
  BrainstormJsonlEvent,
  { kind: "brainstorm_artifact_edited" }
>;
export type BlockedEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_system" }>;
export type GenericAgentEvent = Extract<
  AgentEvent,
  { kind: "message_delta" | "tool_call" | "tool_result" | "log" }
>;
type MessageDeltaEvent = Extract<GenericAgentEvent, { kind: "message_delta" }>;
type MessageDeltaGroup = {
  readonly first: MessageDeltaEvent;
  readonly last: MessageDeltaEvent;
  readonly count: number;
};
type MockEvent = Extract<
  BrainstormJsonlEvent,
  { kind: "brainstorm_mock_proposed" | "brainstorm_mock_revised" }
>;
type MockEventEntry = {
  readonly ts: string;
  readonly mock: BrainstormMock;
  readonly editRequestId?: string;
};
type MockSet = {
  readonly setId: string;
  readonly ts: string;
  readonly entries: ReadonlyArray<MockEventEntry>;
};

export type AnswerValue = {
  readonly optionId?: string;
  readonly optionIds?: readonly string[];
  readonly freeText?: string;
};

export type PendingBatch = {
  readonly batchId: string;
  readonly ts: string;
  readonly questions: ReadonlyArray<QuestionEvent>;
  readonly answered: ReadonlyMap<string, AnswerValue>;
};

export type QuestionThread = PendingBatch & {
  readonly state: "open" | "answered";
};

export type TimelineMock = {
  readonly ts: string;
  readonly mock: BrainstormMock;
  readonly locked: boolean;
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly editRequestId?: string;
};

export type RailTone =
  | "question"
  | "answer"
  | "nudge"
  | "reply"
  | "mock"
  | "system"
  | "usage"
  | "artifact"
  | "revision"
  | "tool"
  | "log"
  | "message";

export type RailRow = {
  readonly id: string;
  readonly ts: string;
  readonly tone: RailTone;
  readonly label: string;
  readonly event: BrainstormJsonlEvent | GenericAgentEvent;
  readonly commitSha?: string;
};

export type NudgeSummary = {
  readonly inFlightCount: number;
  readonly latest: NudgeEvent | null;
};

export type NudgeThread = {
  readonly ts: string;
  readonly nudge: NudgeEvent;
  readonly replies: ReadonlyArray<AgentReplyEvent>;
  readonly status: "queued" | "consumed" | "replied";
};

export type FocusItem =
  | { readonly kind: "questions"; readonly ts: string; readonly batch: QuestionThread }
  | { readonly kind: "mocks"; readonly ts: string; readonly mocks: ReadonlyArray<TimelineMock> }
  | { readonly kind: "nudge"; readonly ts: string; readonly thread: NudgeThread }
  | { readonly kind: "reply"; readonly ts: string; readonly reply: AgentReplyEvent }
  | { readonly kind: "revision"; readonly ts: string; readonly event: RevisionEvent };

export type UsageSummary = {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type BrainstormHealth = "live" | "reconnecting" | "frozen";

export type BrainstormTimeline = {
  readonly events: ReadonlyArray<BrainstormJsonlEvent>;
  readonly agentEvents: ReadonlyArray<GenericAgentEvent>;
  readonly railRows: ReadonlyArray<RailRow>;
  readonly pinnedBlocked: BlockedEvent | null;
  readonly pendingBatch: PendingBatch | null;
  readonly questionThreads: ReadonlyArray<QuestionThread>;
  readonly nudgeThreads: ReadonlyArray<NudgeThread>;
  readonly activeNudges: ReadonlyArray<NudgeEvent>;
  readonly focusItems: ReadonlyArray<FocusItem>;
  readonly mocks: ReadonlyArray<TimelineMock>;
  readonly chosenMockId: string | null;
  readonly nudgeSummary: NudgeSummary;
  readonly usage: UsageSummary;
  readonly activity: ActivityState;
  readonly activityStartedAtMs: number | null;
  readonly artifactAnchors: ReadonlyMap<string, ArtifactEditEvent>;
  readonly health: BrainstormHealth;
  readonly pastBrainstorm: boolean;
  readonly failed: boolean;
};

const PAST_BRAINSTORM: ReadonlySet<TaskStatus> = new Set([
  "planning",
  "plan_failed",
  "executing",
  "code_failed",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "pr_failed",
  "done",
  "cancelled",
]);

export function useBrainstormTimeline({
  initialEvents,
  initialAgentEvents,
  liveEvents,
  connected,
  taskStatus,
  gate,
  runId,
  nowMs,
}: {
  readonly initialEvents: ReadonlyArray<BrainstormJsonlEvent>;
  readonly initialAgentEvents?: ReadonlyArray<AgentEvent>;
  readonly liveEvents: ReadonlyArray<AgentEvent>;
  readonly connected: boolean;
  readonly taskStatus: TaskStatus;
  readonly gate: BrainstormGate;
  readonly runId: string | null;
  readonly nowMs: number;
}): BrainstormTimeline {
  return useMemo(() => {
    const projected = liveEvents
      .map(projectAgentEvent)
      .filter((event): event is BrainstormJsonlEvent => event !== null);
    const events = mergeEvents(initialEvents, projected);
    const agentEvents = mergeAgentEvents(initialAgentEvents ?? [], liveEvents);
    const pastBrainstorm = PAST_BRAINSTORM.has(taskStatus);
    const failed = taskStatus === "brainstorm_failed";
    const ready = hasReadyEvent(events);
    const pinnedBlocked = latestBlocked(events);
    const activity =
      gate === "awaiting_user" || ready || pinnedBlocked || runId === null
        ? null
        : deriveActivity(agentEvents, nowMs);
    const mocks = createTimelineMocks(events, taskStatus);
    const questionThreads = createQuestionThreads(events);
    const nudgeThreads = createNudgeThreads(events);

    return {
      events,
      agentEvents,
      railRows: createRailRows(events, agentEvents),
      pinnedBlocked,
      pendingBatch: createPendingBatch(questionThreads),
      questionThreads,
      nudgeThreads,
      activeNudges: nudgeThreads
        .filter((thread) => !thread.nudge.consumed)
        .map((thread) => thread.nudge),
      focusItems: createFocusItems({
        events,
        questionThreads,
        nudgeThreads,
        mocks,
      }),
      mocks,
      chosenMockId: latestSelectedMockId(events),
      nudgeSummary: createNudgeSummary(nudgeThreads),
      usage: latestUsage(events),
      activity,
      activityStartedAtMs: activity === null ? null : latestToolCallMs(agentEvents),
      artifactAnchors: createArtifactAnchors(events),
      health: healthFor({ connected, pastBrainstorm, failed, runId }),
      pastBrainstorm,
      failed,
    };
  }, [connected, gate, initialAgentEvents, initialEvents, liveEvents, nowMs, runId, taskStatus]);
}

export function projectAgentEvent(event: AgentEvent): BrainstormJsonlEvent | null {
  const ts = event.ts instanceof Date ? event.ts.toISOString() : String(event.ts);
  switch (event.kind) {
    case "brainstorm_question":
      return {
        kind: "brainstorm_question",
        ts,
        questionId: event.questionId,
        prompt: event.prompt,
        options: event.options.map((option) => ({
          id: option.id,
          label: option.label,
          recommended: option.recommended,
          evidence: option.evidence,
          ...(option.description !== undefined ? { description: option.description } : {}),
        })),
        sectionTarget: event.sectionTarget,
        batchId: event.batchId,
        ...(event.multiSelect === true ? { multiSelect: true } : {}),
      };
    case "brainstorm_answer":
      return {
        kind: "brainstorm_answer",
        ts,
        questionId: event.questionId,
        ...(event.optionId !== undefined ? { optionId: event.optionId } : {}),
        ...(event.optionIds !== undefined ? { optionIds: event.optionIds } : {}),
        ...(event.freeText !== undefined ? { freeText: event.freeText } : {}),
      };
    case "brainstorm_system":
      return {
        kind: "brainstorm_system",
        ts,
        systemKind: event.systemKind,
        ...(event.data !== undefined ? { data: event.data } : {}),
      };
    case "brainstorm_revision_requested":
      return { kind: "brainstorm_revision_requested", ts, comment: event.comment };
    case "brainstorm_user_nudge":
      return {
        kind: "brainstorm_user_nudge",
        ts,
        nudgeId: event.nudgeId,
        comment: event.comment,
        consumed: event.consumed,
      };
    case "brainstorm_usage":
      return {
        kind: "brainstorm_usage",
        ts,
        tickIndex: event.tickIndex,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        costUsd: event.costUsd,
        cumulativeInputTokens: event.cumulativeInputTokens,
        cumulativeOutputTokens: event.cumulativeOutputTokens,
        cumulativeCostUsd: event.cumulativeCostUsd,
      };
    case "brainstorm_artifact_edited":
      return {
        kind: "brainstorm_artifact_edited",
        ts,
        artifact: event.artifact,
        commitSha: event.commitSha,
        sizeDelta: event.sizeDelta,
      };
    case "brainstorm_agent_reply":
      return {
        kind: "brainstorm_agent_reply",
        ts,
        replyId: event.replyId,
        message: event.message,
        ...(event.inReplyToNudgeId !== undefined
          ? { inReplyToNudgeId: event.inReplyToNudgeId }
          : {}),
      };
    case "brainstorm_mock_proposed":
      return {
        kind: "brainstorm_mock_proposed",
        ts,
        ...(event.mockSetId !== undefined ? { mockSetId: event.mockSetId } : {}),
        mock: event.mock,
      };
    case "brainstorm_mock_revised":
      return {
        kind: "brainstorm_mock_revised",
        ts,
        ...(event.mockSetId !== undefined ? { mockSetId: event.mockSetId } : {}),
        mock: event.mock,
        editRequestId: event.editRequestId,
      };
    case "brainstorm_mock_selected":
      return { kind: "brainstorm_mock_selected", ts, mockId: event.mockId };
    case "brainstorm_mock_edit_requested":
      return {
        kind: "brainstorm_mock_edit_requested",
        ts,
        requestId: event.requestId,
        mockId: event.mockId,
        comment: event.comment,
      };
    default:
      return null;
  }
}

export function mergeEvents(
  initial: ReadonlyArray<BrainstormJsonlEvent>,
  live: ReadonlyArray<BrainstormJsonlEvent>,
): BrainstormJsonlEvent[] {
  const out = [...initial];
  const seen = new Set(initial.map(eventKey));
  for (const event of live) {
    const key = eventKey(event);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(event);
    }
  }
  return out.sort(compareByTs);
}

export function mergeAgentEvents(
  initial: ReadonlyArray<AgentEvent>,
  live: ReadonlyArray<AgentEvent>,
): GenericAgentEvent[] {
  const out: GenericAgentEvent[] = [];
  const seen = new Set<string>();
  for (const event of [...initial, ...live]) {
    if (!isGenericAgentEvent(event)) continue;
    const key = agentEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out.sort(compareByTs);
}

export function eventKey(event: BrainstormJsonlEvent): string {
  switch (event.kind) {
    case "brainstorm_question":
    case "brainstorm_answer":
      return `${event.kind}:${event.questionId}`;
    case "brainstorm_system":
      return `${event.kind}:${event.systemKind}:${event.ts}`;
    case "brainstorm_revision_requested":
      return `${event.kind}:${event.ts}`;
    case "brainstorm_user_nudge":
      return `${event.kind}:${event.nudgeId}:${event.consumed ? "1" : "0"}`;
    case "brainstorm_usage":
      return `${event.kind}:${event.tickIndex}`;
    case "brainstorm_artifact_edited":
      return `${event.kind}:${event.commitSha}`;
    case "brainstorm_agent_reply":
      return `${event.kind}:${event.replyId}`;
    case "brainstorm_mock_proposed":
    case "brainstorm_mock_revised":
      return `${event.kind}:${event.mock.mockId}:${event.ts}`;
    case "brainstorm_mock_selected":
      return `${event.kind}:${event.mockId}:${event.ts}`;
    case "brainstorm_mock_edit_requested":
      return `${event.kind}:${event.requestId}`;
  }
}

function createRailRows(
  events: ReadonlyArray<BrainstormJsonlEvent>,
  agentEvents: ReadonlyArray<GenericAgentEvent>,
): RailRow[] {
  return [
    ...events.map(domainRailRow),
    ...createAgentRailRows(agentEvents),
  ].sort(compareByTs);
}

function createPendingBatch(batches: ReadonlyArray<QuestionThread>): PendingBatch | null {
  return (
    batches.find((batch) => batch.state === "open") ?? null
  );
}

function createQuestionThreads(events: ReadonlyArray<BrainstormJsonlEvent>): QuestionThread[] {
  const batches = new Map<string, { ts: string; questions: QuestionEvent[] }>();
  for (const event of events) {
    if (event.kind !== "brainstorm_question") continue;
    const batchId = event.batchId ?? `legacy:${event.questionId}`;
    const existing = batches.get(batchId);
    batches.set(batchId, {
      ts: existing?.ts ?? event.ts,
      questions: [...(existing?.questions ?? []), event],
    });
  }
  const answers = answerByQuestionId(events);
  return [...batches.entries()]
    .map(([batchId, batch]): QuestionThread => {
      const state: QuestionThread["state"] = batch.questions.every((question) =>
        answers.has(question.questionId),
      )
        ? "answered"
        : "open";
      return {
        batchId,
        ts: batch.ts,
        questions: batch.questions,
        answered: answers,
        state,
      };
    })
    .sort(compareByTs);
}

function answerByQuestionId(
  events: ReadonlyArray<BrainstormJsonlEvent>,
): Map<string, { optionId?: string; optionIds?: string[]; freeText?: string }> {
  return events.reduce((answers, event) => {
    if (event.kind !== "brainstorm_answer") return answers;
    answers.set(event.questionId, {
      ...(event.optionId !== undefined ? { optionId: event.optionId } : {}),
      ...(event.optionIds !== undefined ? { optionIds: event.optionIds } : {}),
      ...(event.freeText !== undefined ? { freeText: event.freeText } : {}),
    });
    return answers;
  }, new Map<string, { optionId?: string; optionIds?: string[]; freeText?: string }>());
}

export function createTimelineMocks(
  events: ReadonlyArray<BrainstormJsonlEvent>,
  taskStatus: TaskStatus,
): TimelineMock[] {
  const selected = latestSelectedMockId(events);
  const lockedIds = lockedMockIds(events);
  const mockEvents = latestMockSetEvents(events);
  const activeSelected = selected !== null && mockEvents.some((entry) => entry.mock.mockId === selected);
  return [...mockEvents]
    .sort(compareByTs)
    .map((entry) => ({
      ts: entry.ts,
      mock: entry.mock,
      locked: taskStatus !== "brainstorming" || lockedIds.has(entry.mock.mockId),
      selected: selected === entry.mock.mockId,
      dimmed: activeSelected && selected !== entry.mock.mockId,
      ...(entry.editRequestId !== undefined ? { editRequestId: entry.editRequestId } : {}),
    }));
}

function latestMockSetEvents(
  events: ReadonlyArray<BrainstormJsonlEvent>,
): ReadonlyArray<MockEventEntry> {
  return createMockSets(events).at(-1)?.entries ?? [];
}

function createMockSets(events: ReadonlyArray<BrainstormJsonlEvent>): ReadonlyArray<MockSet> {
  const sets = new Map<string, { ts: string; entries: Map<string, MockEventEntry> }>();
  let legacySetIndex = 0;
  let currentLegacySetId: string | null = null;

  for (const event of [...events].sort(compareByTs)) {
    if (!isMockEvent(event)) {
      currentLegacySetId = null;
      continue;
    }

    const setId: string =
      event.mockSetId ?? currentLegacySetId ?? `legacy:${legacySetIndex + 1}`;
    if (event.mockSetId === undefined && currentLegacySetId === null) {
      legacySetIndex += 1;
      currentLegacySetId = setId;
    }
    if (event.mockSetId !== undefined) {
      currentLegacySetId = null;
    }

    const existing = sets.get(setId);
    const entry = mockEventEntry(event);
    if (existing) {
      existing.entries.set(event.mock.mockId, entry);
    } else {
      sets.set(setId, {
        ts: event.ts,
        entries: new Map([[event.mock.mockId, entry]]),
      });
    }
  }

  return [...sets.entries()]
    .map(([setId, set]): MockSet => ({
      setId,
      ts: set.ts,
      entries: [...set.entries.values()].sort(compareByTs),
    }))
    .sort(compareByTs);
}

function isMockEvent(event: BrainstormJsonlEvent): event is MockEvent {
  return event.kind === "brainstorm_mock_proposed" || event.kind === "brainstorm_mock_revised";
}

function mockEventEntry(event: MockEvent): MockEventEntry {
  return {
    ts: event.ts,
    mock: event.mock,
    ...(event.kind === "brainstorm_mock_revised" ? { editRequestId: event.editRequestId } : {}),
  };
}

function lockedMockIds(events: ReadonlyArray<BrainstormJsonlEvent>): Set<string> {
  const known = new Set<string>();
  const locked = new Set<string>();
  for (const event of events) {
    if (event.kind === "brainstorm_mock_proposed" || event.kind === "brainstorm_mock_revised") {
      known.add(event.mock.mockId);
    }
    if (event.kind === "brainstorm_mock_edit_requested") {
      locked.add(event.mockId);
    }
    if (event.kind === "brainstorm_mock_selected" || event.kind === "brainstorm_revision_requested") {
      known.forEach((mockId) => locked.add(mockId));
    }
  }
  return locked;
}

function latestSelectedMockId(events: ReadonlyArray<BrainstormJsonlEvent>): string | null {
  return (
    [...events].reverse().find((event) => event.kind === "brainstorm_mock_selected")
      ?.mockId ?? null
  );
}

function createNudgeThreads(events: ReadonlyArray<BrainstormJsonlEvent>): NudgeThread[] {
  const nudges = new Map<string, NudgeEvent>();
  const replies = new Map<string, AgentReplyEvent[]>();
  for (const event of events) {
    if (event.kind === "brainstorm_user_nudge") {
      const prior = nudges.get(event.nudgeId);
      nudges.set(event.nudgeId, prior ? { ...event, ts: prior.ts } : event);
    }
    if (event.kind === "brainstorm_agent_reply" && event.inReplyToNudgeId) {
      replies.set(event.inReplyToNudgeId, [
        ...(replies.get(event.inReplyToNudgeId) ?? []),
        event,
      ]);
    }
  }
  return [...nudges.values()].sort(compareByTs).map((nudge) => {
    const pairedReplies = [...(replies.get(nudge.nudgeId) ?? [])].sort(compareByTs);
    const status: NudgeThread["status"] =
      pairedReplies.length > 0 ? "replied" : nudge.consumed ? "consumed" : "queued";
    return {
      ts: nudge.ts,
      nudge,
      replies: pairedReplies,
      status,
    };
  });
}

function createNudgeSummary(nudgeThreads: ReadonlyArray<NudgeThread>): NudgeSummary {
  const list = [...nudgeThreads].sort(compareByTs);
  return {
    inFlightCount: list.filter((thread) => !thread.nudge.consumed).length,
    latest: list.at(-1)?.nudge ?? null,
  };
}

function createFocusItems({
  events,
  questionThreads,
  nudgeThreads,
  mocks,
}: {
  readonly events: ReadonlyArray<BrainstormJsonlEvent>;
  readonly questionThreads: ReadonlyArray<QuestionThread>;
  readonly nudgeThreads: ReadonlyArray<NudgeThread>;
  readonly mocks: ReadonlyArray<TimelineMock>;
}): FocusItem[] {
  const pairedReplyIds = new Set(
    nudgeThreads.flatMap((thread) => thread.replies.map((reply) => reply.replyId)),
  );
  const items: FocusItem[] = [
    ...questionThreads.map(questionFocusItem),
    ...nudgeThreads.map(nudgeFocusItem),
    ...events
      .filter(
        (event): event is AgentReplyEvent =>
          event.kind === "brainstorm_agent_reply" && !pairedReplyIds.has(event.replyId),
      )
      .map(replyFocusItem),
    ...events
      .filter((event): event is RevisionEvent => event.kind === "brainstorm_revision_requested")
      .map(revisionFocusItem),
  ];
  const mockTs = mocks[0]?.ts ?? null;
  if (mockTs !== null && mocks.length > 0) {
    items.push({ kind: "mocks", ts: mockTs, mocks });
  }
  return items.sort(compareByTs);
}

function questionFocusItem(batch: QuestionThread): FocusItem {
  return { kind: "questions", ts: batch.ts, batch };
}

function nudgeFocusItem(thread: NudgeThread): FocusItem {
  return { kind: "nudge", ts: thread.ts, thread };
}

function replyFocusItem(reply: AgentReplyEvent): FocusItem {
  return { kind: "reply", ts: reply.ts, reply };
}

function revisionFocusItem(event: RevisionEvent): FocusItem {
  return { kind: "revision", ts: event.ts, event };
}

function latestUsage(events: ReadonlyArray<BrainstormJsonlEvent>): UsageSummary {
  const usage = [...events].reverse().find((event) => event.kind === "brainstorm_usage");
  if (!usage || usage.kind !== "brainstorm_usage") {
    return { costUsd: 0, inputTokens: 0, outputTokens: 0 };
  }
  return {
    costUsd: usage.cumulativeCostUsd,
    inputTokens: usage.cumulativeInputTokens,
    outputTokens: usage.cumulativeOutputTokens,
  };
}

function createArtifactAnchors(
  events: ReadonlyArray<BrainstormJsonlEvent>,
): Map<string, ArtifactEditEvent> {
  const anchors = new Map<string, ArtifactEditEvent>();
  for (const event of events) {
    if (event.kind === "brainstorm_artifact_edited") {
      anchors.set(event.artifact, event);
      anchors.set(event.commitSha, event);
    }
  }
  return anchors;
}

function domainRailRow(event: BrainstormJsonlEvent): RailRow {
  const commitSha =
    event.kind === "brainstorm_artifact_edited" ? event.commitSha : undefined;
  return {
    id: eventKey(event),
    ts: event.ts,
    tone: railTone(event),
    label: railLabel(event),
    event,
    ...(commitSha !== undefined ? { commitSha } : {}),
  };
}

function agentRailRow(event: GenericAgentEvent): RailRow {
  return {
    id: agentEventKey(event),
    ts: eventTs(event),
    tone: agentRailTone(event),
    label: agentRailLabel(event),
    event,
  };
}

function createAgentRailRows(events: ReadonlyArray<GenericAgentEvent>): RailRow[] {
  return groupMessageDeltas(events).map((entry) =>
    isMessageDeltaGroup(entry) ? messageDeltaRailRow(entry) : agentRailRow(entry),
  );
}

function groupMessageDeltas(
  events: ReadonlyArray<GenericAgentEvent>,
): ReadonlyArray<GenericAgentEvent | MessageDeltaGroup> {
  const grouped: Array<GenericAgentEvent | MessageDeltaGroup> = [];
  let pending: MessageDeltaGroup | null = null;
  for (const event of events) {
    if (event.kind === "message_delta") {
      pending = pending === null
        ? { first: event, last: event, count: 1 }
        : { first: pending.first, last: event, count: pending.count + 1 };
      continue;
    }
    if (pending !== null) {
      grouped.push(pending);
      pending = null;
    }
    grouped.push(event);
  }
  if (pending !== null) grouped.push(pending);
  return grouped;
}

function isMessageDeltaGroup(
  entry: GenericAgentEvent | MessageDeltaGroup,
): entry is MessageDeltaGroup {
  return "first" in entry;
}

function messageDeltaRailRow(group: MessageDeltaGroup): RailRow {
  return {
    id: `agent:message_delta:${group.first.id}:${group.last.id}`,
    ts: eventTs(group.first),
    tone: "message",
    label: `agent stream · ${group.count} chunk${group.count === 1 ? "" : "s"}`,
    event: group.first,
  };
}

function isGenericAgentEvent(event: AgentEvent): event is GenericAgentEvent {
  return (
    event.kind === "message_delta" ||
    event.kind === "tool_call" ||
    event.kind === "tool_result" ||
    event.kind === "log"
  );
}

function agentEventKey(event: GenericAgentEvent): string {
  return `agent:${event.kind}:${event.id}`;
}

function eventTs(event: AgentEvent): string {
  return event.ts instanceof Date ? event.ts.toISOString() : String(event.ts);
}

function latestBlocked(events: ReadonlyArray<BrainstormJsonlEvent>): BlockedEvent | null {
  const blocked = [...events]
    .reverse()
    .find(
      (event): event is BlockedEvent =>
        event.kind === "brainstorm_system" && event.systemKind === "blocked",
    );
  return blocked ?? null;
}

function hasReadyEvent(events: ReadonlyArray<BrainstormJsonlEvent>): boolean {
  return events.some(
    (event) => event.kind === "brainstorm_system" && event.systemKind === "status_changed",
  );
}

function latestToolCallMs(events: ReadonlyArray<GenericAgentEvent>): number | null {
  const event = [...events].reverse().find((candidate) => candidate.kind === "tool_call");
  if (!event) return null;
  const ms = event.ts instanceof Date ? event.ts.getTime() : new Date(event.ts).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function healthFor({
  connected,
  pastBrainstorm,
  failed,
  runId,
}: {
  readonly connected: boolean;
  readonly pastBrainstorm: boolean;
  readonly failed: boolean;
  readonly runId: string | null;
}): BrainstormHealth {
  if (pastBrainstorm || failed || runId === null) return "frozen";
  return connected ? "live" : "reconnecting";
}

function railTone(event: BrainstormJsonlEvent): RailTone {
  switch (event.kind) {
    case "brainstorm_question":
      return "question";
    case "brainstorm_answer":
      return "answer";
    case "brainstorm_user_nudge":
      return "nudge";
    case "brainstorm_agent_reply":
      return "reply";
    case "brainstorm_mock_proposed":
    case "brainstorm_mock_revised":
    case "brainstorm_mock_selected":
    case "brainstorm_mock_edit_requested":
      return "mock";
    case "brainstorm_artifact_edited":
      return "artifact";
    case "brainstorm_revision_requested":
      return "revision";
    case "brainstorm_usage":
      return "usage";
    case "brainstorm_system":
      return "system";
  }
}

function agentRailTone(event: GenericAgentEvent): RailTone {
  if (event.kind === "tool_call" || event.kind === "tool_result") return "tool";
  if (event.kind === "log") return "log";
  return "message";
}

function railLabel(event: BrainstormJsonlEvent): string {
  switch (event.kind) {
    case "brainstorm_question":
      return `${event.questionId}: ${event.prompt}`;
    case "brainstorm_answer":
      return `answered ${event.questionId}`;
    case "brainstorm_user_nudge":
      return `${event.consumed ? "nudge consumed" : "nudge queued"}: ${event.comment}`;
    case "brainstorm_agent_reply":
      return `agent replied: ${event.message}`;
    case "brainstorm_mock_proposed":
      return `mock proposed: ${event.mock.title}`;
    case "brainstorm_mock_revised":
      return `mock revised: ${event.mock.title}`;
    case "brainstorm_mock_selected":
      return `mock chosen: ${event.mockId}`;
    case "brainstorm_mock_edit_requested":
      return `mock edit requested: ${event.comment}`;
    case "brainstorm_artifact_edited":
      return `${event.artifact}.md edited · ${event.sizeDelta >= 0 ? "+" : ""}${event.sizeDelta}`;
    case "brainstorm_revision_requested":
      return `revision requested: ${event.comment}`;
    case "brainstorm_usage":
      return `usage: $${event.cumulativeCostUsd.toFixed(4)}`;
    case "brainstorm_system":
      return systemLabel(event);
  }
}

function agentRailLabel(event: GenericAgentEvent): string {
  switch (event.kind) {
    case "tool_call": {
      const arg = summarizeToolArg(event.tool, event.input);
      return `tool · ${event.tool}${arg ? ` ${arg}` : ""}`;
    }
    case "tool_result":
      return `tool ${event.ok ? "done" : "failed"} · ${event.tool}`;
    case "log":
      return `${event.level}: ${event.text}`;
    case "message_delta":
      return "agent stream";
  }
}

function systemLabel(event: Extract<BrainstormJsonlEvent, { kind: "brainstorm_system" }>): string {
  if (event.systemKind === "blocked") {
    const reason = event.data?.["reason"];
    return `blocked: ${typeof reason === "string" ? reason : "unknown reason"}`;
  }
  if (event.systemKind === "probe_complete") return "repo probe complete";
  if (event.systemKind === "self_critique_passed") return "self-critique passed";
  if (event.systemKind === "status_changed") return "artifacts ready";
  if (event.systemKind === "session_reset") return "session reset";
  return event.systemKind;
}

function compareByTs<T extends { readonly ts: string | Date }>(a: T, b: T): number {
  const ats = a.ts instanceof Date ? a.ts.toISOString() : a.ts;
  const bts = b.ts instanceof Date ? b.ts.toISOString() : b.ts;
  return ats < bts ? -1 : ats > bts ? 1 : 0;
}

function summarizeToolArg(tool: string, input: unknown): string {
  const candidate =
    tool === "bash"
      ? stringProperty(input, "command")
      : stringProperty(input, "path") ??
        stringProperty(input, "filePath") ??
        stringProperty(input, "file_path") ??
        stringProperty(input, "pattern") ??
        stringProperty(input, "query");
  return typeof candidate === "string" ? clip(candidate, 80) : "";
}

function stringProperty(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const entry = Object.entries(input).find(([entryKey]) => entryKey === key);
  const value = entry?.[1];
  return typeof value === "string" ? value : undefined;
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
