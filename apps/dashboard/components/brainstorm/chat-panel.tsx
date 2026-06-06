"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BrainstormMock } from "@pi-harness/shared";
import type { AgentEvent, TaskStatus } from "@pi-harness/shared";
import type { BrainstormGate, BrainstormJsonlEvent } from "@/lib/api";
import { useBrainstormEvents } from "@/lib/brainstorm-events-context";
import {
  selectBrainstormMockAction,
  submitBrainstormMockEditAction,
} from "@/app/tasks/[id]/actions";
import { QuestionBatch } from "./question-card";
import { NudgeInput } from "./nudge-input";
import { ActivityLine, deriveActivity, type ActivityState } from "./activity-line";
import { createTimelineMocks } from "./use-brainstorm-timeline";

// Renders the brainstorm transcript from JSONL events. Live updates: the
// page passes the server-rendered snapshot as `initialEvents`, and we
// subscribe to /api/live/stream?runId=:runId to append new
// brainstorm_* events as the agent emits them.
//
// Questions are paired with their answers so the UI shows a clean Q/A
// timeline rather than two disjoint streams.
export function ChatPanel({
  taskId,
  runId,
  initialEvents,
  gate,
  taskStatus,
}: {
  taskId: string;
  runId: string | null;
  initialEvents: BrainstormJsonlEvent[];
  gate: BrainstormGate;
  taskStatus: TaskStatus;
}) {
  const { events: liveEvents } = useBrainstormEvents();
  const router = useRouter();

  // Merge the server-rendered snapshot with the live SSE stream. Bundle
  // events arrive without an envelope; SSE events carry an AgentEventBase
  // envelope (id/runId/taskId/ts as Date). Project the latter back into the
  // wire-shape the ChatPanel renders against, dedup by (kind + questionId)
  // for question/answer pairs and (kind + ts) for everything else.
  const events = useMemo(() => {
    const projected = liveEvents
      .map(projectAgentEvent)
      .filter((e): e is BrainstormJsonlEvent => e !== null);
    return mergeEvents(initialEvents, projected);
  }, [initialEvents, liveEvents]);

  // Refresh the page (re-derive the gate server-side) on any event that
  // could move it: agent flipped artifacts to ready (`status_changed`) OR
  // the user filed a revision (`brainstorm_revision_requested`). A single
  // counter over both kinds means we trigger exactly once per change
  // without double-firing on rapid arrivals.
  const gateRelevantCount = events.filter(
    (e) =>
      (e.kind === "brainstorm_system" && e.systemKind === "status_changed") ||
      e.kind === "brainstorm_revision_requested" ||
      e.kind === "brainstorm_mock_proposed" ||
      e.kind === "brainstorm_mock_revised" ||
      e.kind === "brainstorm_mock_selected",
  ).length;
  const prevGateCount = useRef(gateRelevantCount);
  useEffect(() => {
    if (gateRelevantCount > prevGateCount.current) {
      router.refresh();
    }
    prevGateCount.current = gateRelevantCount;
  }, [gateRelevantCount, router]);

  const critique = events.find((e) => e.kind === "brainstorm_system" && e.systemKind === "self_critique_passed");
  const ready = events.find((e) => e.kind === "brainstorm_system" && e.systemKind === "status_changed");
  // Latest blocked event wins (the agent may have retried after a transient
  // failure). Reasons land in `data.reason`. Show this prominently — it's
  // the only signal the user gets that the brainstorm tick failed.
  const blocked = [...events]
    .reverse()
    .find(
      (e): e is Extract<BrainstormJsonlEvent, { kind: "brainstorm_system" }> =>
        e.kind === "brainstorm_system" && e.systemKind === "blocked",
    );
  const blockedReason =
    (blocked?.data as { reason?: string } | undefined)?.reason ?? "unknown error";
  const probe = events.find((e) => e.kind === "brainstorm_system" && e.systemKind === "probe_complete");

  // Build one chronological timeline. Items render in ts order so that, e.g.,
  // a question batch asked AFTER a nudge appears below the nudge — preserving
  // the actual sequence of the conversation.
  //
  // - Question batches group all questions sharing a batchId; the batch's
  //   anchor ts is its first question's ts (so a multi-question batch slots
  //   in at the moment it was asked, not when the last question landed).
  // - Nudges carry their paired agent replies (matched by inReplyToNudgeId)
  //   inline; the cluster is anchored at the nudge ts.
  // - Standalone replies (no parent nudge) slot in by their own ts.
  // - System events (probe, critique, ready) and revisions also flow in ts
  //   order. The blocked banner is the one exception — it stays pinned at
  //   the top of the transcript as a current-state alert, not history.
  const answerByQid = new Map<
    string,
    Extract<BrainstormJsonlEvent, { kind: "brainstorm_answer" }>
  >();
  for (const e of events) {
    if (e.kind === "brainstorm_answer") answerByQid.set(e.questionId, e);
  }

  type QuestionEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }>;
  type NudgeEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_user_nudge" }>;
  type ReplyEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_agent_reply" }>;

  const batchById = new Map<
    string,
    { batchId: string; ts: string; questions: QuestionEvent[] }
  >();
  const nudgeById = new Map<string, NudgeEvent>();
  const repliesByNudgeId = new Map<string, ReplyEvent[]>();
  const standaloneReplies: ReplyEvent[] = [];
  const selectedMockIds = new Set<string>();
  const lockedMockIds = new Set<string>();
  const mockEventById = new Map<
    string,
    { ts: string; mock: BrainstormMock; editRequestId?: string }
  >();
  const activeMockIds = new Set(
    createTimelineMocks(events, taskStatus).map((entry) => entry.mock.mockId),
  );

  for (const e of events) {
    if (e.kind === "brainstorm_question") {
      const id = e.batchId ?? `legacy:${e.questionId}`;
      const existing = batchById.get(id);
      if (existing) {
        existing.questions.push(e);
      } else {
        batchById.set(id, { batchId: id, ts: e.ts, questions: [e] });
      }
    } else if (e.kind === "brainstorm_user_nudge") {
      // Last write wins (consumed:true replaces consumed:false), but keep the
      // first-seen ts as the anchor so the cluster doesn't jump when the
      // orchestrator republishes.
      const prior = nudgeById.get(e.nudgeId);
      nudgeById.set(e.nudgeId, prior ? { ...e, ts: prior.ts } : e);
    } else if (e.kind === "brainstorm_agent_reply") {
      if (e.inReplyToNudgeId !== undefined) {
        const list = repliesByNudgeId.get(e.inReplyToNudgeId) ?? [];
        list.push(e);
        repliesByNudgeId.set(e.inReplyToNudgeId, list);
      } else {
        standaloneReplies.push(e);
      }
    } else if (e.kind === "brainstorm_mock_selected") {
      selectedMockIds.add(e.mockId);
    }
  }
  for (const e of events) {
    if (e.kind === "brainstorm_mock_proposed" || e.kind === "brainstorm_mock_revised") {
      mockEventById.set(e.mock.mockId, {
        ts: e.ts,
        mock: e.mock,
        ...(e.kind === "brainstorm_mock_revised" ? { editRequestId: e.editRequestId } : {}),
      });
    } else if (e.kind === "brainstorm_mock_edit_requested") {
      lockedMockIds.add(e.mockId);
    } else if (
      e.kind === "brainstorm_mock_selected" ||
      e.kind === "brainstorm_revision_requested"
    ) {
      for (const mockId of mockEventById.keys()) lockedMockIds.add(mockId);
    }
  }
  // A reply whose parent nudge never arrived becomes standalone (otherwise it
  // would silently disappear).
  for (const [nudgeId, list] of repliesByNudgeId) {
    if (!nudgeById.has(nudgeId)) {
      standaloneReplies.push(...list);
      repliesByNudgeId.delete(nudgeId);
    }
  }

  type TimelineItem =
    | { kind: "system"; ts: string; systemKind: string }
    | { kind: "revision"; ts: string; comment: string }
    | {
        kind: "batch";
        ts: string;
        batchId: string;
        questions: QuestionEvent[];
      }
    | {
        kind: "nudge";
        ts: string;
        nudge: NudgeEvent;
        pairedReplies: ReplyEvent[];
      }
    | { kind: "reply"; ts: string; reply: ReplyEvent }
    | { kind: "mock"; ts: string; mock: BrainstormMock; editRequestId?: string };

  const timeline: TimelineItem[] = [];
  for (const e of events) {
    if (e.kind === "brainstorm_system") {
      // Blocked is rendered as a pinned banner above the transcript; skip it
      // here so it doesn't double-render.
      if (e.systemKind === "blocked") continue;
      // Only surface system events that have a meaningful UI affordance.
      if (
        e.systemKind === "probe_complete" ||
        e.systemKind === "self_critique_passed" ||
        e.systemKind === "status_changed"
      ) {
        timeline.push({ kind: "system", ts: e.ts, systemKind: e.systemKind });
      }
    } else if (e.kind === "brainstorm_revision_requested") {
      timeline.push({ kind: "revision", ts: e.ts, comment: e.comment });
    }
  }
  for (const mockEvent of mockEventById.values()) {
    if (!activeMockIds.has(mockEvent.mock.mockId)) continue;
    timeline.push({ kind: "mock", ...mockEvent });
  }
  for (const b of batchById.values()) {
    timeline.push({ kind: "batch", ts: b.ts, batchId: b.batchId, questions: b.questions });
  }
  for (const n of nudgeById.values()) {
    timeline.push({
      kind: "nudge",
      ts: n.ts,
      nudge: n,
      pairedReplies: repliesByNudgeId.get(n.nudgeId) ?? [],
    });
  }
  for (const r of standaloneReplies) {
    timeline.push({ kind: "reply", ts: r.ts, reply: r });
  }
  // Stable sort by ts; ties keep insertion order.
  timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // Counts used by the header + the "waiting for next question…" indicator.
  const totalQuestions = Array.from(batchById.values()).reduce(
    (n, b) => n + b.questions.length,
    0,
  );
  const answeredQuestions = Array.from(batchById.values()).reduce(
    (n, b) => n + b.questions.filter((q) => answerByQid.has(q.questionId)).length,
    0,
  );
  const allAnswered = totalQuestions > 0 && answeredQuestions === totalQuestions;

  // Nudges are usable while the brainstorm run exists. A ready-but-not-approved
  // brainstorm still accepts nudges; the server reopens it as a revision.
  const nudgesEnabled =
    runId !== null &&
    !blocked &&
    taskStatus === "brainstorming";

  // Live activity line. We re-derive on every SSE event AND every second so
  // the "thinking" threshold (60s without a tool_result) eventually fires
  // even when the SSE stream goes quiet.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const activity: ActivityState = useMemo(() => {
    if (gate === "awaiting_user" || ready || blocked || runId === null) return null;
    return deriveActivity(liveEvents, nowMs);
  }, [liveEvents, nowMs, gate, ready, blocked, runId]);

  return (
    <main className="flex min-h-0 min-w-0 flex-col border-r border-line">
      <header className="flex h-9 items-center gap-3 border-b border-line px-6 font-mono text-[11px] tracking-[0.04em] text-fg-mute">
        <span className="uppercase text-fg-subtle">TRANSCRIPT</span>
        <span className="ml-auto text-fg-subtle">
          {totalQuestions} questions · {answeredQuestions} answered
        </span>
      </header>

      <div className="scroll-hide flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4.5">
        {blocked && (
          <div className="rounded border border-st-blocked/40 bg-white/[0.02] px-3 py-2.5 text-[13px]">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-blocked">
              brainstorm blocked
            </div>
            <div className="mt-1 text-fg-body">{blockedReason}</div>
            <div className="mt-1.5 font-mono text-[10.5px] text-fg-subtle">
              fix the underlying issue, then retry from the task page.
            </div>
          </div>
        )}

        {timeline.map((item) => {
          if (item.kind === "system") {
            const label =
              item.systemKind === "probe_complete"
                ? "probed repo"
                : item.systemKind === "self_critique_passed"
                  ? "self-critique passed"
                  : "artifacts ready for approval";
            const tone = item.systemKind === "status_changed" ? "done" : undefined;
            return (
              <SystemLine
                key={`sys:${item.systemKind}:${item.ts}`}
                label={label}
                {...(tone ? { tone } : {})}
              />
            );
          }
          if (item.kind === "revision") {
            return (
              <div
                key={`rev:${item.ts}`}
                className="rounded border border-st-review/35 bg-white/[0.02] px-3 py-2 text-[13px] text-st-review"
              >
                <div className="font-mono text-[10.5px] uppercase tracking-[0.06em]">
                  revision requested
                </div>
                <div className="mt-1 text-fg-body">{item.comment}</div>
              </div>
            );
          }
          if (item.kind === "batch") {
            const answeredMap = new Map<
              string,
              { optionId?: string; optionIds?: string[]; freeText?: string }
            >();
            for (const q of item.questions) {
              const a = answerByQid.get(q.questionId);
              if (a) {
                answeredMap.set(q.questionId, {
                  ...(a.optionId !== undefined ? { optionId: a.optionId } : {}),
                  ...(a.optionIds !== undefined ? { optionIds: a.optionIds } : {}),
                  ...(a.freeText !== undefined ? { freeText: a.freeText } : {}),
                });
              }
            }
            return (
              <QuestionBatch
                key={`b:${item.batchId}`}
                taskId={taskId}
                questions={item.questions}
                answered={answeredMap}
              />
            );
          }
          if (item.kind === "nudge") {
            return (
              <div key={`n:${item.nudge.nudgeId}`} className="flex flex-col gap-1" data-testid="nudge-cluster">
                <div className="rounded border border-line bg-white/[0.02] px-3 py-2 text-[12.5px] text-fg-body">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-mute">
                    you nudged · {item.nudge.consumed ? "agent saw this" : "queued"}
                  </div>
                  <div className="mt-0.5">{item.nudge.comment}</div>
                </div>
                {item.pairedReplies.map((r) => (
                  <ReplyCard key={r.replyId} reply={r} indented />
                ))}
              </div>
            );
          }
          if (item.kind === "mock") {
            return (
              <MockCard
                key={`mock:${item.mock.mockId}:${item.ts}`}
                taskId={taskId}
                mock={item.mock}
                selected={selectedMockIds.has(item.mock.mockId)}
                editable={
                  taskStatus === "brainstorming" && !lockedMockIds.has(item.mock.mockId)
                }
              />
            );
          }
          return <ReplyCard key={`r:${item.reply.replyId}`} reply={item.reply} indented={false} />;
        })}

        {/*
          Waiting indicator. Shown when every question so far is answered, the
          run hasn't reached self-critique/ready, and the gate isn't open. The
          activity line below takes priority — once we know what the agent is
          actually doing, the generic "waiting" line is noise.
        */}
        {allAnswered &&
          !critique &&
          !ready &&
          gate !== "awaiting_user" &&
          activity === null && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-fg-mute">
              <span className="tick-anim">·</span>
              <span>waiting for next question…</span>
            </div>
          )}

        <ActivityLine activity={activity} />

        {totalQuestions === 0 && !probe && !blocked && (
          runId === null ? (
            <div className="text-center font-mono text-[12px] text-fg-subtle">
              Brainstorm hasn’t started — task is in {taskStatus}.
            </div>
          ) : (
            <div className="flex items-center gap-2 font-mono text-[11px] text-fg-mute">
              <span className="tick-anim">·</span>
              <span>Agent is spinning up — probing repo…</span>
            </div>
          )
        )}

        {gate === "awaiting_user" && taskStatus === "brainstorming" && (
          <div className="mt-2 rounded border border-st-progress/35 bg-white/[0.02] px-3 py-2 font-mono text-[12px] text-st-progress">
            Waiting for your approval — see the right pane.
          </div>
        )}

        <NudgeInput taskId={taskId} disabled={!nudgesEnabled} />
      </div>
    </main>
  );
}

// Agent reply card — chat-bubble style. When `indented` is true the reply is
// visually nested under the originating nudge (small left margin + accent
// border). Standalone replies (no parent nudge) span the full width.
function ReplyCard({
  reply,
  indented,
}: {
  reply: Extract<BrainstormJsonlEvent, { kind: "brainstorm_agent_reply" }>;
  indented: boolean;
}) {
  return (
    <div
      data-testid="reply-card"
      className={`rounded border border-st-progress/35 bg-white/[0.02] px-3 py-2 text-[12.5px] text-fg-body ${
        indented ? "ml-4 border-l-2 border-l-st-progress/60" : ""
      }`}
    >
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-progress">
        agent replied
      </div>
      <div className="mt-0.5 whitespace-pre-wrap">{reply.message}</div>
    </div>
  );
}

function MockCard({
  taskId,
  mock,
  selected,
  editable,
}: {
  taskId: string;
  mock: BrainstormMock;
  selected: boolean;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const canSubmitEdit = comment.trim().length > 0 && !pending;

  const submitEdit = (): void => {
    if (!canSubmitEdit) return;
    const next = comment.trim();
    start(async () => {
      await submitBrainstormMockEditAction(taskId, mock.mockId, next);
      setComment("");
      setEditing(false);
    });
  };

  const choose = (): void => {
    if (selected) return;
    start(async () => {
      await selectBrainstormMockAction(taskId, mock.mockId);
    });
  };

  return (
    <div
      data-testid="brainstorm-mock-card"
      className={`rounded border bg-card px-3 py-2.5 text-[13px] ${
        selected ? "border-st-done/60" : "border-line"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium text-fg">{mock.title}</span>
            {mock.recommended && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-progress">
                recommended
              </span>
            )}
            {selected && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-done">
                selected
              </span>
            )}
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.45] text-fg-mute">{mock.summary}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mock.pages.map((page) => (
              <span
                key={page.pageId}
                className="rounded border border-line bg-white/[0.02] px-2 py-0.5 font-mono text-[10.5px] text-fg-subtle"
              >
                {page.title}
              </span>
            ))}
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-fg-subtle">
            {mock.pages.length} {mock.pages.length === 1 ? "page" : "pages"}
          </div>
          {mock.derivedFrom && (
            <div className="mt-1 font-mono text-[10.5px] text-fg-subtle">
              derived from {mock.derivedFrom}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={`/tasks/${taskId}/brainstorm/mocks/${mock.mockId}` as never}
            aria-label={`Open mock ${mock.title}`}
            className="rounded border border-line px-2 py-1 font-mono text-[11px] text-fg-body hover:border-line-hover hover:bg-white/[0.03]"
          >
            Open
          </Link>
          <button
            type="button"
            aria-label={`Edit mock ${mock.title}`}
            disabled={!editable || pending}
            onClick={() => setEditing((v) => !v)}
            className="rounded border border-line px-2 py-1 font-mono text-[11px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-55"
          >
            Edit
          </button>
          <button
            type="button"
            aria-label={`Choose mock ${mock.title}`}
            disabled={!editable || selected}
            onClick={choose}
            className="rounded bg-st-progress px-2.5 py-1 font-mono text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint disabled:hover:brightness-100"
          >
            {selected ? "Chosen" : "Choose"}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-2 border-t border-line pt-2">
          <textarea
            aria-label="Mock edit request"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={pending}
            placeholder="Describe the mock change…"
            className="min-h-14 w-full resize-none border-0 bg-transparent p-0 text-[12.5px] leading-[1.5] text-fg outline-none placeholder:text-fg-faint"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setComment("");
              }}
              disabled={pending}
              className="rounded border border-line px-2 py-1 font-mono text-[11px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitEdit}
              disabled={!canSubmitEdit}
              className="rounded bg-st-progress px-2.5 py-1 font-mono text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint disabled:hover:brightness-100"
            >
              {pending ? "Submitting…" : "Submit mock edit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SystemLine({ label, tone }: { label: string; tone?: "done" }) {
  const cls = tone === "done" ? "text-st-done" : "text-fg-mute";
  return (
    <div className={`flex items-center gap-2 font-mono text-[11px] ${cls}`}>
      <span className="text-fg-faint">·</span>
      <span>{label}</span>
    </div>
  );
}

// Strip the AgentEventBase envelope and keep only the brainstorm_* kinds.
// Returns null for unrelated events (tool_call, log, etc.) so the chat
// transcript ignores them.
function projectAgentEvent(e: AgentEvent): BrainstormJsonlEvent | null {
  const ts = e.ts instanceof Date ? e.ts.toISOString() : String(e.ts);
  switch (e.kind) {
    case "brainstorm_question":
      return {
        kind: "brainstorm_question",
        ts,
        questionId: e.questionId,
        prompt: e.prompt,
        options: e.options,
        sectionTarget: e.sectionTarget,
        batchId: e.batchId,
        ...(e.multiSelect ? { multiSelect: true } : {}),
      };
    case "brainstorm_answer":
      return {
        kind: "brainstorm_answer",
        ts,
        questionId: e.questionId,
        ...(e.optionId !== undefined ? { optionId: e.optionId } : {}),
        ...(e.freeText !== undefined ? { freeText: e.freeText } : {}),
      };
    case "brainstorm_system":
      return {
        kind: "brainstorm_system",
        ts,
        systemKind: e.systemKind,
        ...(e.data !== undefined ? { data: e.data } : {}),
      };
    case "brainstorm_revision_requested":
      return { kind: "brainstorm_revision_requested", ts, comment: e.comment };
    case "brainstorm_user_nudge":
      return {
        kind: "brainstorm_user_nudge",
        ts,
        nudgeId: e.nudgeId,
        comment: e.comment,
        consumed: e.consumed,
      };
    case "brainstorm_usage":
      return {
        kind: "brainstorm_usage",
        ts,
        tickIndex: e.tickIndex,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUsd: e.costUsd,
        cumulativeInputTokens: e.cumulativeInputTokens,
        cumulativeOutputTokens: e.cumulativeOutputTokens,
        cumulativeCostUsd: e.cumulativeCostUsd,
      };
    case "brainstorm_artifact_edited":
      return {
        kind: "brainstorm_artifact_edited",
        ts,
        artifact: e.artifact,
        commitSha: e.commitSha,
        sizeDelta: e.sizeDelta,
      };
    case "brainstorm_agent_reply":
      return {
        kind: "brainstorm_agent_reply",
        ts,
        replyId: e.replyId,
        message: e.message,
        ...(e.inReplyToNudgeId !== undefined
          ? { inReplyToNudgeId: e.inReplyToNudgeId }
          : {}),
      };
    case "brainstorm_mock_proposed":
      return {
        kind: "brainstorm_mock_proposed",
        ts,
        ...(e.mockSetId !== undefined ? { mockSetId: e.mockSetId } : {}),
        mock: e.mock,
      };
    case "brainstorm_mock_revised":
      return {
        kind: "brainstorm_mock_revised",
        ts,
        ...(e.mockSetId !== undefined ? { mockSetId: e.mockSetId } : {}),
        mock: e.mock,
        editRequestId: e.editRequestId,
      };
    case "brainstorm_mock_selected":
      return { kind: "brainstorm_mock_selected", ts, mockId: e.mockId };
    case "brainstorm_mock_edit_requested":
      return {
        kind: "brainstorm_mock_edit_requested",
        ts,
        requestId: e.requestId,
        mockId: e.mockId,
        comment: e.comment,
      };
    default:
      return null;
  }
}

// Merge initial + live arrays without duplicates. Question/answer events
// dedup on questionId; system/revision events dedup on (kind, ts). Order
// within each source is preserved; live events are appended after the
// initial snapshot.
function mergeEvents(
  initial: BrainstormJsonlEvent[],
  live: BrainstormJsonlEvent[],
): BrainstormJsonlEvent[] {
  const out: BrainstormJsonlEvent[] = [...initial];
  const seen = new Set(initial.map(eventKey));
  for (const e of live) {
    const k = eventKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

function eventKey(e: BrainstormJsonlEvent): string {
  switch (e.kind) {
    case "brainstorm_question":
    case "brainstorm_answer":
      return `${e.kind}:${e.questionId}`;
    case "brainstorm_system":
      return `${e.kind}:${e.systemKind}:${e.ts}`;
    case "brainstorm_revision_requested":
      return `${e.kind}:${e.ts}`;
    case "brainstorm_user_nudge":
      // Dedup by (nudgeId, consumed) so the orchestrator's consumed:true
      // replacement event lands as a distinct row from the original
      // consumed:false. The chat panel's render-time map then keeps only
      // the latest per nudgeId, so the user sees one entry that flips from
      // "queued" to "agent saw this" as it gets processed.
      return `${e.kind}:${e.nudgeId}:${e.consumed ? "1" : "0"}`;
    case "brainstorm_usage":
      // One usage event per tick — dedup on tickIndex.
      return `${e.kind}:${e.tickIndex}`;
    case "brainstorm_artifact_edited":
      // Each edit emits exactly one event with its commitSha.
      return `${e.kind}:${e.commitSha}`;
    case "brainstorm_agent_reply":
      // Each reply has a unique replyId.
      return `${e.kind}:${e.replyId}`;
    case "brainstorm_mock_proposed":
    case "brainstorm_mock_revised":
      return `${e.kind}:${e.mock.mockId}:${e.ts}`;
    case "brainstorm_mock_selected":
      return `${e.kind}:${e.mockId}:${e.ts}`;
    case "brainstorm_mock_edit_requested":
      return `${e.kind}:${e.requestId}`;
  }
}
