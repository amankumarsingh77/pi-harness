"use client";

import { useState, useTransition } from "react";
import { cancelCurrentPhaseAction } from "@/app/tasks/[id]/actions";

type PhaseName = "brainstorm" | "plan";

export function CancelPhaseRunButton({
  taskId,
  phase,
  disabled,
  compact = false,
  source = "header",
}: {
  readonly taskId: string;
  readonly phase: PhaseName;
  readonly disabled: boolean;
  readonly compact?: boolean;
  readonly source?: "header" | "preflight-agent";
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const noun = phase === "brainstorm" ? "brainstorm run" : "plan run";
  const buttonLabel = compact ? "Cancel" : `Cancel ${phase}`;

  const submit = (): void => {
    start(async () => {
      await cancelCurrentPhaseAction(taskId);
      setOpen(false);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || pending}
        className={[
          "rounded-md border border-line bg-transparent font-mono text-fg-mute transition-colors hover:border-st-blocked/60 hover:text-st-blocked disabled:cursor-not-allowed disabled:opacity-55",
          compact ? "px-2 py-1 text-[10.5px]" : "px-2.5 py-1 text-[11.5px]",
        ].join(" ")}
      >
        {pending ? "Cancelling..." : buttonLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Cancel ${noun}`}
          onClick={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="w-[440px] max-w-full rounded border border-line bg-card p-5 shadow-xl">
            <h2 className="m-0 text-[15px] font-semibold tracking-[-0.012em] text-fg">
              Cancel {noun}?
            </h2>
            <p className="mt-2 text-[12.5px] leading-[1.55] text-fg-mute">
              This stops the active {noun} and leaves the task in {phase}.
              {source === "preflight-agent"
                ? " All plan preflight agents for this run stop together."
                : " You can restart this phase afterward."}
            </p>

            <div className="mt-4 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
              >
                Keep running
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md bg-st-blocked px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {pending ? "Cancelling..." : `Cancel ${noun}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
