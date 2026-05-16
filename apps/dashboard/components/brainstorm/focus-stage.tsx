"use client";

import Link from "next/link";
import { useRef } from "react";
import type { TaskStatus } from "@pi-harness/shared";
import { Composer, type ComposerHandle } from "./composer";
import { MockStrip } from "./mock-strip";
import { QuestionThreadStage } from "./question-stage";
import type {
  AgentReplyEvent,
  BrainstormTimeline,
  FocusItem,
  NudgeThread,
  RevisionEvent,
} from "./use-brainstorm-timeline";

export function FocusStage({
  taskId,
  taskStatus,
  timeline,
}: {
  readonly taskId: string;
  readonly taskStatus: TaskStatus;
  readonly timeline: BrainstormTimeline;
}) {
  const composerRef = useRef<ComposerHandle | null>(null);

  if (timeline.pastBrainstorm) {
    return (
      <main className="brainstorm-focus is-flat">
        <Link href={`/tasks/${taskId}/plan` as never} className="brainstorm-next-link">
          brainstorm completed - see plan phase
        </Link>
      </main>
    );
  }

  if (timeline.failed) {
    return (
      <main className="brainstorm-focus">
        <div className="brainstorm-focus-scroll">
          <section className="brainstorm-focus-card border-st-blocked/40">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-blocked">
              brainstorm blocked
            </span>
            <p className="mt-2 text-[13px] text-fg-body">
              {timeline.pinnedBlocked ? blockedReason(timeline.pinnedBlocked) : "The run failed."}
            </p>
            <p className="mt-1 font-mono text-[11px] text-fg-subtle">
              Restart from the header to start a fresh tick.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const composerDisabled = taskStatus !== "brainstorming";

  return (
    <main className="brainstorm-focus">
      <div className="brainstorm-focus-scroll">
        <div className="brainstorm-focus-list">
          {timeline.focusItems.map((item) => (
            <FocusItemView
              key={focusItemKey(item)}
              item={item}
              taskId={taskId}
              onFocusComposer={() => composerRef.current?.focus()}
            />
          ))}
        </div>
        {timeline.focusItems.length === 0 && (
          <div className="brainstorm-waiting-line">
            <span className="pulse-dot" aria-hidden="true" />
            <span>{timeline.events.length === 0 ? "agent spinning up..." : "waiting for agent..."}</span>
          </div>
        )}
      </div>
      <Composer
        ref={composerRef}
        taskId={taskId}
        disabled={composerDisabled}
        nudgeSummary={timeline.nudgeSummary}
        activeNudges={timeline.activeNudges}
      />
    </main>
  );
}

function FocusItemView({
  item,
  taskId,
  onFocusComposer,
}: {
  readonly item: FocusItem;
  readonly taskId: string;
  readonly onFocusComposer: () => void;
}) {
  switch (item.kind) {
    case "questions":
      return <QuestionThreadStage taskId={taskId} batch={item.batch} />;
    case "mocks":
      return <MockStrip taskId={taskId} mocks={item.mocks} onFocusComposer={onFocusComposer} />;
    case "nudge":
      return <NudgeThreadCard thread={item.thread} />;
    case "reply":
      return <ReplyCard reply={item.reply} />;
    case "revision":
      return <RevisionCard event={item.event} />;
  }
}

function NudgeThreadCard({ thread }: { readonly thread: NudgeThread }) {
  return (
    <section className="brainstorm-thread-card tone-nudge" data-testid="nudge-thread">
      <div className="thread-meta">
        <span>you nudged</span>
        <span>{nudgeStatusLabel(thread)}</span>
      </div>
      <p>{thread.nudge.comment}</p>
      {thread.replies.map((reply) => (
        <div key={reply.replyId} className="thread-reply">
          <span>agent replied</span>
          <p>{reply.message}</p>
        </div>
      ))}
    </section>
  );
}

function ReplyCard({ reply }: { readonly reply: AgentReplyEvent }) {
  return (
    <section className="brainstorm-thread-card tone-reply" data-testid="agent-reply">
      <div className="thread-meta">
        <span>agent replied</span>
        <span>{formatTime(reply.ts)}</span>
      </div>
      <p>{reply.message}</p>
    </section>
  );
}

function RevisionCard({ event }: { readonly event: RevisionEvent }) {
  return (
    <section className="brainstorm-thread-card tone-revision">
      <div className="thread-meta">
        <span>changes requested</span>
        <span>{formatTime(event.ts)}</span>
      </div>
      <p>{event.comment}</p>
    </section>
  );
}

function focusItemKey(item: FocusItem): string {
  switch (item.kind) {
    case "questions":
      return `questions:${item.batch.batchId}`;
    case "mocks":
      return `mocks:${item.ts}`;
    case "nudge":
      return `nudge:${item.thread.nudge.nudgeId}`;
    case "reply":
      return `reply:${item.reply.replyId}`;
    case "revision":
      return `revision:${item.ts}`;
  }
}

function nudgeStatusLabel(thread: NudgeThread): string {
  if (thread.status === "queued") return "queued";
  if (thread.status === "replied") return "replied";
  return "agent saw this";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function blockedReason(event: NonNullable<BrainstormTimeline["pinnedBlocked"]>): string {
  const reason = event.data?.["reason"];
  return typeof reason === "string" ? reason : "unknown error";
}
