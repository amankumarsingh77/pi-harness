"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Clipboard, FileText } from "lucide-react";
import type { TaskStatus } from "@pi-harness/shared";
import { Composer, type ComposerHandle } from "./composer";
import { MockStrip } from "./mock-strip";
import { QuestionThreadStage } from "./question-stage";
import type {
  AgentReplyEvent,
  BlockedEvent,
  BrainstormTimeline,
  FocusItem,
  NudgeThread,
  RevisionEvent,
} from "./use-brainstorm-timeline";
import { Alert } from "@/components/ui/alert";
import { RestartButton } from "./restart-button";

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
    const reason = failedReason(timeline);
    const diagnostic = brainstormDiagnostic({ taskId, reason, timeline });
    return (
      <main className="brainstorm-focus">
        <div className="brainstorm-focus-scroll">
          <BrainstormFailurePanel taskId={taskId} reason={reason} diagnostic={diagnostic} />
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

function BrainstormFailurePanel({
  taskId,
  reason,
  diagnostic,
}: {
  readonly taskId: string;
  readonly reason: string;
  readonly diagnostic: string;
}) {
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDiagnostic = async (): Promise<void> => {
    await navigator.clipboard.writeText(diagnostic);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Alert tone="danger" title="Brainstorm failed" label="Brainstorm recovery">
      <p className="m-0 break-words font-mono text-[12.5px]">{reason}</p>
      <p className="m-0 mt-1 text-[12px] text-fg-mute">
        Restart creates a fresh brainstorm run and keeps the archived transcript available.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[12px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
          aria-expanded={showDiagnostic}
          onClick={() => setShowDiagnostic((current) => !current)}
        >
          <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
          View full error
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-[12px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
          onClick={() => void copyDiagnostic()}
        >
          <Clipboard size={13} strokeWidth={1.8} aria-hidden="true" />
          {copied ? "Copied" : "Copy diagnostic"}
        </button>
        <RestartButton taskId={taskId} disabled={false} label="Restart brainstorm" />
      </div>
      {showDiagnostic && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-line bg-black/[0.16] p-3 text-[11px] leading-5 text-fg-body">
          {diagnostic}
        </pre>
      )}
    </Alert>
  );
}

function brainstormDiagnostic({
  taskId,
  reason,
  timeline,
}: {
  readonly taskId: string;
  readonly reason: string;
  readonly timeline: BrainstormTimeline;
}): string {
  return JSON.stringify(
    {
      taskId,
      reason,
      failed: timeline.failed,
      blocked: timeline.pinnedBlocked ?? null,
      eventCount: timeline.events.length,
      latestEvents: timeline.events.slice(-5),
    },
    null,
    2,
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

function failedReason(timeline: BrainstormTimeline): string {
  const statusEvent = [...timeline.events]
    .reverse()
    .find(
      (event): event is BlockedEvent =>
        event.kind === "brainstorm_system" &&
        event.systemKind === "status_changed",
    );
  const reason = statusEvent?.data?.["reason"];
  if (typeof reason === "string" && reason.length > 0) return reason;
  return timeline.pinnedBlocked ? blockedReason(timeline.pinnedBlocked) : "The run failed.";
}
