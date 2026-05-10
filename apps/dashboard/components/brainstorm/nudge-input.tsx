"use client";
import { useState, useTransition } from "react";
import { submitBrainstormNudgeAction } from "@/app/tasks/[id]/actions";

const MAX_LEN = 4000;

// Free-form input that injects a brainstorm_user_nudge for the agent to fold
// into its next prompt. Fire-and-forget — once submitted, the message lands
// in the transcript via SSE like any other event.
export function NudgeInput({
  taskId,
  disabled,
}: {
  taskId: string;
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState("");

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_LEN;
  const canSend = trimmed.length > 0 && !tooLong && !disabled && !pending;

  const submit = (): void => {
    if (!canSend) return;
    const comment = trimmed;
    start(async () => {
      await submitBrainstormNudgeAction(taskId, comment);
      setValue("");
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd/Ctrl+Enter sends. Plain Enter inserts a newline so multi-line
    // nudges don't fire on the first return key.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={`mt-2 rounded border ${
        tooLong ? "border-st-blocked/50" : "border-line"
      } bg-input px-3 py-2.5`}
      data-testid="nudge-input"
    >
      <textarea
        aria-label="Nudge the agent"
        className="min-h-12 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.5] text-fg outline-none placeholder:text-fg-faint disabled:opacity-55"
        placeholder={
          disabled
            ? "Brainstorm not active — nudges are disabled"
            : "Nudge the agent — anything you want it to know before its next question (⌘/Ctrl+Enter to send)"
        }
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled || pending}
      />
      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-fg-mute">
        <span className={tooLong ? "text-st-blocked" : ""}>
          {trimmed.length}/{MAX_LEN}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="rounded border border-line px-2.5 py-1 text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {pending ? "Sending…" : "Send nudge"}
        </button>
      </div>
    </div>
  );
}
