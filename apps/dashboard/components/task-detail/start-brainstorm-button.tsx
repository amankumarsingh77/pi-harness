"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@pi-harness/shared";
import { mutations } from "@/lib/client/queries";

const START_BRAINSTORM = {
  type: "user_start_brainstorm",
  workflow: "backend-feature",
} as const;

export function StartBrainstormButton({ task }: { readonly task: Task }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (task.status !== "backlog") return null;

  async function startBrainstorm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await mutations.transitionTask(task.id).mutationFn(START_BRAINSTORM);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start brainstorm");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        aria-label={pending ? "Starting..." : "Start brainstorm"}
        disabled={pending}
        onClick={() => {
          void startBrainstorm();
        }}
        className="inline-flex h-8 items-center justify-center rounded-md border border-st-progress/70 bg-st-progress/15 px-3 font-mono text-[11px] font-medium text-st-progress transition-colors hover:border-st-progress hover:bg-st-progress/20 disabled:cursor-wait disabled:border-line disabled:bg-white/[0.025] disabled:text-fg-faint"
      >
        {pending ? "Starting..." : "Start brainstorm"}
      </button>
      {error && (
        <p
          role="status"
          aria-live="polite"
          className="max-w-[220px] text-right font-mono text-[10.5px] leading-snug text-st-blocked"
        >
          {error}
        </p>
      )}
    </div>
  );
}
