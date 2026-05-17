"use client";

import { forwardRef, useImperativeHandle, useRef, useState, useTransition } from "react";
import { submitBrainstormNudgeAction } from "@/app/tasks/[id]/actions";
import type { NudgeEvent, NudgeSummary } from "./use-brainstorm-timeline";

const MAX_LEN = 4000;

export type ComposerHandle = {
  readonly focus: () => void;
};

export const Composer = forwardRef<
  ComposerHandle,
  {
    readonly taskId: string;
    readonly disabled: boolean;
    readonly nudgeSummary: NudgeSummary;
    readonly activeNudges: ReadonlyArray<NudgeEvent>;
  }
>(function Composer({ taskId, disabled, nudgeSummary, activeNudges }, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  const trimmed = value.trim();
  const tooLong = trimmed.length > MAX_LEN;
  const canSend = trimmed.length > 0 && !tooLong && !disabled && !pending;

  const submit = (): void => {
    if (!canSend) return;
    const comment = trimmed;
    setError(null);
    start(async () => {
      try {
        await submitBrainstormNudgeAction(taskId, comment);
        setValue("");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to send nudge");
      }
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setValue("");
      setError(null);
      return;
    }
    if (event.key === "Enter" && event.shiftKey) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section className="brainstorm-composer" aria-label="Nudge composer">
      <div className="composer-context">
        <span>last nudge</span>
        <span className="truncate">
          {nudgeSummary.latest
            ? `${nudgeSummary.latest.consumed ? "consumed" : "queued"} · ${nudgeSummary.latest.comment}`
            : "none yet"}
        </span>
      </div>
      {activeNudges.length > 0 && (
        <div className="composer-queued-shelf" data-testid="queued-nudge-shelf">
          {activeNudges.map((nudge) => (
            <div key={nudge.nudgeId} className="composer-queued-nudge">
              <span>queued</span>
              <p>{nudge.comment}</p>
            </div>
          ))}
        </div>
      )}
      <div className={`composer-box ${tooLong ? "is-invalid" : ""}`}>
        <textarea
          ref={textareaRef}
          aria-label="Nudge the agent"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || pending}
          placeholder={disabled ? "Brainstorm is not accepting nudges" : "Nudge the agent"}
        />
        <button type="button" disabled={!canSend} onClick={submit}>
          {pending ? "Sending" : "Send"}
        </button>
      </div>
      <div className="composer-hints">
        <span className={nudgeSummary.inFlightCount > 0 ? "text-st-shipping" : ""}>
          {nudgeSummary.inFlightCount} in flight · {trimmed.length}/{MAX_LEN}
        </span>
        <span>
          <kbd>cmd enter</kbd> send <kbd>esc</kbd> clear <kbd>shift enter</kbd> newline
        </span>
      </div>
      {error && <div className="composer-error">{error}</div>}
    </section>
  );
});
