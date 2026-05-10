"use client";

import { useState, useTransition } from "react";
import type { Task } from "@pi-harness/shared";
import type { PlanGate } from "@/lib/api";
import { approvePlan, requestPlanChanges } from "@/app/tasks/[id]/plan/actions";

// Sticky bottom bar that shows up only when the plan phase is awaiting user
// approval. Approve advances to executing; Request changes opens a textarea
// for the comment that re-runs the planner. Mirrors the brainstorm
// ApprovalGate in posture but is plan-scoped.
export function PlanApprovalGate({
  taskId,
  gate,
  taskStatus,
}: {
  taskId: string;
  gate: PlanGate;
  taskStatus: Task["status"];
}) {
  const [pending, start] = useTransition();
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (taskStatus !== "planning" || gate !== "awaiting_user") return null;

  const onApprove = () =>
    start(async () => {
      setError(null);
      try {
        await approvePlan(taskId);
      } catch (e) {
        setError((e as Error).message);
      }
    });

  const onRequestChanges = () =>
    start(async () => {
      setError(null);
      try {
        await requestPlanChanges(taskId, comment);
        setComment("");
        setShowComment(false);
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <section className="sticky bottom-0 border-t border-line bg-card px-6 py-3">
      {showComment ? (
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[11px] text-fg-mute" htmlFor="plan-revision-comment">
            Describe what to change (≥ 10 chars)
          </label>
          <textarea
            id="plan-revision-comment"
            className="min-h-[60px] resize-none rounded border border-line bg-bg p-2 font-mono text-[12.5px] text-fg outline-none focus:border-line-hover"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={pending}
            placeholder="The plan should …"
          />
          {error && (
            <span className="font-mono text-[11px] text-st-blocked">{error}</span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-line bg-transparent px-3 py-1.5 text-[12px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                setShowComment(false);
                setComment("");
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-st-blocked px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
              disabled={pending || comment.trim().length < 10}
              onClick={onRequestChanges}
            >
              Send revision
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="flex-1 leading-[1.45]">
            <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
              Plan ready for review
            </div>
            <div className="mt-0.5 font-mono text-[11.5px] text-fg-mute">
              Approve to advance to coder · request changes to re-run planner
            </div>
          </div>
          {error && (
            <span className="font-mono text-[11px] text-st-blocked">{error}</span>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-line bg-transparent px-3 py-1.5 text-[12px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-50"
              disabled={pending}
              onClick={() => setShowComment(true)}
            >
              Request changes
            </button>
            <button
              type="button"
              className="rounded bg-st-progress px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50"
              disabled={pending}
              onClick={onApprove}
            >
              {pending ? "Approving…" : "Approve plan"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
