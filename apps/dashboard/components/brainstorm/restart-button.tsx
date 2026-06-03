"use client";
import { useState, useTransition } from "react";
import { restartBrainstormAction } from "@/app/tasks/[id]/actions";

// Two-step confirm: click "Restart" → modal opens with optional note +
// confirm/cancel. Discards the current run irreversibly (the artifacts are
// recoverable via git history of the archive commit, but the dashboard
// transcript clears).
//
// Disabled when the task is past brainstorming. While ticking, restart is
// allowed — the orchestrator drains the in-flight tick before archiving.
export function RestartButton({
  taskId,
  disabled,
  label = "Restart",
}: {
  readonly taskId: string;
  readonly disabled: boolean;
  readonly label?: string;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const submit = (): void => {
    const finalNote = note.trim();
    start(async () => {
      await restartBrainstormAction(
        taskId,
        finalNote.length > 0 ? finalNote : undefined,
      );
      setOpen(false);
      setNote("");
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || pending}
        className="rounded-md border border-line bg-transparent px-2.5 py-1 font-mono text-[11.5px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body disabled:cursor-not-allowed disabled:opacity-55"
        data-testid="restart-button"
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Restart brainstorm"
          data-testid="restart-modal"
          onClick={(e) => {
            // Click on the backdrop (not the modal itself) closes.
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="w-[480px] max-w-full rounded border border-line bg-card p-5 shadow-xl">
            <h2 className="m-0 text-[15px] font-semibold tracking-[-0.012em] text-fg">
              Restart brainstorm?
            </h2>
            <p className="mt-2 text-[12.5px] leading-[1.55] text-fg-mute">
              Discards the current run. Old artifacts and transcript move into
              the archive — recoverable via git, but the dashboard view clears.
              Optional note below seeds the new run as the first nudge.
            </p>

            <textarea
              aria-label="What should the agent do differently?"
              className="mt-3 min-h-20 w-full resize-none rounded border border-line bg-input p-2.5 text-[13px] leading-[1.5] text-fg outline-none placeholder:text-fg-faint disabled:opacity-55"
              placeholder="What should the agent do differently? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
            />

            <div className="mt-3 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setNote("");
                }}
                disabled={pending}
                className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md bg-st-blocked px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {pending ? "Restarting…" : "Restart brainstorm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
