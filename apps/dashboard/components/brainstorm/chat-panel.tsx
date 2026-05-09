"use client";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AgentEvent } from "@pi-harness/shared";
import type { BrainstormJsonlEvent } from "@/lib/api";
import { useEvents } from "@/lib/use-events";
import { QuestionCard } from "./question-card";

// Renders the brainstorm transcript from JSONL events. Live updates: the
// page passes the server-rendered snapshot as `initialEvents`, and we
// subscribe to /api/proxy/runs/:runId/events/stream to append new
// brainstorm_* events as the agent emits them.
//
// Questions are paired with their answers so the UI shows a clean Q/A
// timeline rather than two disjoint streams.
export function ChatPanel({
  taskId,
  runId,
  initialEvents,
  awaitingApproval,
}: {
  taskId: string;
  runId: string | null;
  initialEvents: BrainstormJsonlEvent[];
  awaitingApproval: boolean;
}) {
  const { events: liveEvents } = useEvents(runId);
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

  // When the agent emits status_changed, the gate's awaitingApproval flag has
  // moved on the server. Re-render the page so the bundle re-fetches and the
  // header + ApprovalGate read the new state.
  const statusChangeCount = events.filter(
    (e) => e.kind === "brainstorm_system" && e.systemKind === "status_changed",
  ).length;
  const prevStatusCount = useRef(statusChangeCount);
  useEffect(() => {
    if (statusChangeCount > prevStatusCount.current) {
      router.refresh();
    }
    prevStatusCount.current = statusChangeCount;
  }, [statusChangeCount, router]);

  const probe = events.find((e) => e.kind === "brainstorm_system" && e.systemKind === "probe_complete");
  const critique = events.find((e) => e.kind === "brainstorm_system" && e.systemKind === "self_critique_passed");
  const ready = events.find((e) => e.kind === "brainstorm_system" && e.systemKind === "status_changed");
  const revisions = events.filter((e) => e.kind === "brainstorm_revision_requested");

  // Pair each question with its answer (if any).
  const questions = events
    .filter((e): e is Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }> => e.kind === "brainstorm_question")
    .map((q) => {
      const answer = events.find(
        (a): a is Extract<BrainstormJsonlEvent, { kind: "brainstorm_answer" }> =>
          a.kind === "brainstorm_answer" && a.questionId === q.questionId,
      );
      return { q, answer };
    });

  return (
    <main className="flex min-h-0 min-w-0 flex-col border-r border-line">
      <header className="flex h-9 items-center gap-3 border-b border-line px-6 font-mono text-[11px] tracking-[0.04em] text-fg-mute">
        <span className="uppercase text-fg-subtle">TRANSCRIPT</span>
        <span className="ml-auto text-fg-subtle">
          {questions.length} questions · {questions.filter((p) => p.answer).length} answered
        </span>
      </header>

      <div className="scroll-hide flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4.5">
        {probe && <SystemLine label="probed repo" />}

        {revisions.length > 0 && (
          <div className="rounded border border-st-review/35 bg-white/[0.02] px-3 py-2 text-[13px] text-st-review">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.06em]">revision requested</div>
            {revisions.map((r, i) => (
              <div key={i} className="mt-1 text-fg-body">{r.comment}</div>
            ))}
          </div>
        )}

        {questions.map(({ q, answer }) => (
          <QuestionCard
            key={q.questionId}
            taskId={taskId}
            question={q}
            answered={
              answer
                ? {
                    ...(answer.optionId !== undefined ? { optionId: answer.optionId } : {}),
                    ...(answer.optionIds !== undefined ? { optionIds: answer.optionIds } : {}),
                    ...(answer.freeText !== undefined ? { freeText: answer.freeText } : {}),
                  }
                : undefined
            }
          />
        ))}

        {/*
          Waiting indicator. Shown when every question so far is answered, the
          run hasn't reached self-critique/ready, and the gate isn't open. The
          next brainstorm_question landing via SSE replaces this line.
        */}
        {questions.length > 0 &&
          questions.every((p) => p.answer) &&
          !critique &&
          !ready &&
          !awaitingApproval && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-fg-mute">
              <span className="tick-anim">·</span>
              <span>waiting for next question…</span>
            </div>
          )}

        {critique && <SystemLine label="self-critique passed" />}
        {ready && <SystemLine label="artifacts ready for approval" tone="done" />}

        {questions.length === 0 && !probe && (
          <div className="text-center font-mono text-[12px] text-fg-subtle">
            Brainstorm hasn’t started yet.
          </div>
        )}

        {awaitingApproval && (
          <div className="mt-2 rounded border border-st-progress/35 bg-white/[0.02] px-3 py-2 font-mono text-[12px] text-st-progress">
            Waiting for your approval — see the right pane.
          </div>
        )}
      </div>
    </main>
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
  }
}

