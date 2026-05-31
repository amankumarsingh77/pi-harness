"use client";
import { useState, useTransition } from "react";
import {
  confirmPromoteAction,
  promoteBrainstormMockAction,
  selectBrainstormMockAction,
  submitBrainstormMockEditAction,
} from "@/app/tasks/[id]/actions";
import type { TokenDiff } from "@/lib/api";
import { PromoteModal } from "./promote-modal";

export function MockPreviewActions({
  taskId,
  mockId,
  selected,
  locked,
}: {
  taskId: string;
  mockId: string;
  selected: boolean;
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [promoting, startPromote] = useTransition();
  const [promoteDiff, setPromoteDiff] = useState<TokenDiff | null>(null);
  const canSubmit = comment.trim().length > 0 && !pending;

  return (
    <div className="flex items-center gap-1.5">
      {editing && (
        <textarea
          aria-label="Mock edit request"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={pending}
          placeholder="Describe the mock change…"
          className="h-8 w-80 resize-none rounded border border-line bg-input px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-faint disabled:opacity-55"
        />
      )}
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        disabled={locked || pending}
        className="rounded border border-line px-2.5 py-1 font-mono text-[11px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
      >
        Edit
      </button>
      {editing && (
        <button
          type="button"
          aria-label="Submit mock edit"
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return;
            const next = comment.trim();
            start(async () => {
              await submitBrainstormMockEditAction(taskId, mockId, next);
              setComment("");
              setEditing(false);
            });
          }}
          className="rounded bg-st-progress px-2.5 py-1 font-mono text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint"
        >
          {pending ? "Submitting…" : "Submit"}
        </button>
      )}
      <button
        type="button"
        aria-label="Promote mock to design system"
        disabled={promoting}
        onClick={() => {
          if (promoting) return;
          startPromote(async () => {
            const diff = await promoteBrainstormMockAction(taskId, mockId);
            setPromoteDiff(diff);
          });
        }}
        className="rounded border border-line px-2.5 py-1 font-mono text-[11px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
      >
        {promoting ? "Diffing…" : "Promote ↑"}
      </button>
      <button
        type="button"
        onClick={() => {
          if (locked || selected || pending) return;
          start(async () => {
            await selectBrainstormMockAction(taskId, mockId);
          });
        }}
        disabled={locked || selected || pending}
        className="rounded bg-st-progress px-3 py-1 font-mono text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint"
      >
        {selected ? "Chosen" : "Choose"}
      </button>
      {promoteDiff && (
        <PromoteModal
          diff={promoteDiff}
          onConfirm={() => confirmPromoteAction(taskId, mockId, promoteDiff)}
          onClose={() => setPromoteDiff(null)}
        />
      )}
    </div>
  );
}
