"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { clsx } from "clsx";
import type { TaskStatus } from "@pi-harness/shared";
import type { BrainstormGate } from "@/lib/api";
import { StatusIcon } from "@/components/kanban/status-icon";
import {
  approveBrainstormAction,
  requestBrainstormChangesAction,
} from "@/app/tasks/[id]/actions";

// Four-state gate.
//
//  - not_started  no brainstorm run exists yet. Both buttons disabled, copy
//                 says the agent hasn't been dispatched.
//  - in_progress  run dispatched, agent still ticking. Both buttons disabled.
//  - ready        brainstorming + gate === "awaiting_user". Approve / Request
//                 changes enabled.
//  - past         task has moved past brainstorming. Render a "Brainstorm
//                 approved" affirmation with a link to the next phase. This
//                 only shows during the brief window where the user is still
//                 looking at /brainstorm after approve fired but before the
//                 redirect lands — without it, a stale render shows the
//                 misleading "in progress" copy.
type GateState = "not_started" | "in_progress" | "ready" | "past" | "failed";

const PAST_BRAINSTORM: ReadonlySet<TaskStatus> = new Set([
  "planning",
  "executing",
  "verifying",
  "verification_failed",
  "ready_to_ship",
  "done",
]);

export function ApprovalGate({
  taskId,
  gate,
  taskStatus,
  runId,
}: {
  taskId: string;
  gate: BrainstormGate;
  taskStatus: TaskStatus;
  runId: string | null;
}) {
  const [pending, start] = useTransition();
  const [showRevision, setShowRevision] = useState(false);
  const [comment, setComment] = useState("");

  const state: GateState = PAST_BRAINSTORM.has(taskStatus)
    ? "past"
    : taskStatus === "brainstorm_failed"
      ? "failed"
      : gate === "awaiting_user"
        ? "ready"
        : runId === null
          ? "not_started"
          : "in_progress";
  const ready = state === "ready";

  const submitApprove = () => {
    start(async () => {
      await approveBrainstormAction(taskId);
    });
  };

  const submitRevision = () => {
    if (comment.trim().length < 10) return;
    start(async () => {
      await requestBrainstormChangesAction(taskId, comment.trim());
      setShowRevision(false);
      setComment("");
    });
  };

  if (state === "failed") {
    return (
      <section className="flex items-center gap-3.5 border-t border-st-blocked/40 bg-card px-6 py-3.5">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: "rgba(229,90,90,0.12)",
            boxShadow: "inset 0 0 0 1px rgba(229,90,90,0.4)",
            color: "var(--color-st-blocked)",
          }}
        >
          <StatusIcon kind="blocked" size={14} />
        </span>
        <div className="min-w-0 flex-1 leading-[1.45]">
          <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
            Brainstorm failed
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-fg-mute">
            Restart from the header to start a fresh tick.
          </div>
        </div>
      </section>
    );
  }

  if (state === "past") {
    return (
      <section className="flex items-center gap-3.5 border-t border-line bg-card px-6 py-3.5">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: "rgba(76,183,130,0.12)",
            boxShadow: "inset 0 0 0 1px rgba(76,183,130,0.4)",
            color: "var(--color-st-done)",
          }}
        >
          <StatusIcon kind="done" size={14} />
        </span>
        <div className="min-w-0 flex-1 leading-[1.45]">
          <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
            Brainstorm approved
          </div>
          <div className="mt-0.5 font-mono text-[11.5px] text-fg-mute">
            Task is now in {taskStatus}.
          </div>
        </div>
        <Link
          href={`/tasks/${taskId}/plan` as Route}
          className="rounded-md border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
        >
          View plan →
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2.5 border-t border-line bg-card px-6 py-3.5">
      <div className="grid grid-cols-[28px_1fr_auto] items-center gap-3.5">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: ready ? "rgba(94,106,210,0.12)" : "transparent",
            boxShadow: ready
              ? "inset 0 0 0 1px rgba(94,106,210,0.4)"
              : "inset 0 0 0 1px var(--color-line)",
            color: ready ? "var(--color-st-progress)" : "var(--color-fg-mute)",
          }}
        >
          <StatusIcon kind={ready ? "progress" : "review"} size={14} />
        </span>

        <div className="min-w-0 leading-[1.45]">
          {ready ? (
            <>
              <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
                Ready for approval
              </div>
              <div className="mt-0.5 font-mono text-[11.5px] text-fg-mute">
                Both artifacts marked ready · approving advances to plan
              </div>
            </>
          ) : state === "not_started" ? (
            <>
              <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg-mute">
                Brainstorm not started
              </div>
              <div className="mt-0.5 font-mono text-[11.5px] text-fg-subtle">
                Dispatch from the task page to begin the brainstorm
              </div>
            </>
          ) : (
            <>
              <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg-mute">
                Brainstorm in progress
              </div>
              <div className="mt-0.5 font-mono text-[11.5px] text-fg-subtle">
                Gate unlocks once the agent marks both artifacts ready
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowRevision((v) => !v)}
            disabled={!ready || pending}
            className="rounded-md border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-55"
          >
            Request changes
          </button>
          <button
            type="button"
            onClick={submitApprove}
            disabled={!ready || pending}
            className={clsx(
              "rounded-md px-3.5 py-2 text-[12.5px] font-medium transition-[filter] hover:brightness-110",
              ready
                ? "bg-st-progress text-white"
                : "border border-line bg-white/[0.04] text-fg-faint",
              "disabled:cursor-not-allowed disabled:hover:brightness-100",
            )}
          >
            Approve
          </button>
        </div>
      </div>

      {showRevision && (
        <div className="rounded border border-line bg-input px-3 py-2.5">
          <textarea
            className="min-h-16 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.5] text-fg outline-none placeholder:text-fg-faint"
            placeholder="Describe what to change (≥ 10 characters)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={pending}
          />
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-fg-mute">
            <span>{comment.trim().length}/10 minimum</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => { setShowRevision(false); setComment(""); }}
                className="rounded border border-line px-2.5 py-1 text-fg-mute hover:border-line-hover hover:text-fg-body"
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRevision}
                disabled={pending || comment.trim().length < 10}
                className="rounded bg-st-review px-3 py-1 font-medium text-white disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint"
              >
                Send change request
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
