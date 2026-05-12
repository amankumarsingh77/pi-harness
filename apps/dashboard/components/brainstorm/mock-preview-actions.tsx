"use client";
import { useState, useTransition } from "react";
import {
  selectBrainstormMockAction,
  submitBrainstormMockEditAction,
} from "@/app/tasks/[id]/actions";

export function MockPreviewActions({
  taskId,
  mockId,
  selected,
}: {
  taskId: string;
  mockId: string;
  selected: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
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
        disabled={pending}
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
        onClick={() => {
          if (selected || pending) return;
          start(async () => {
            await selectBrainstormMockAction(taskId, mockId);
          });
        }}
        disabled={selected || pending}
        className="rounded bg-st-progress px-3 py-1 font-mono text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint"
      >
        {selected ? "Chosen" : "Choose"}
      </button>
    </div>
  );
}
