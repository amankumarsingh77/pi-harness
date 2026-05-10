"use client";
import type { Artifact, TaskStatus } from "@pi-harness/shared";
import { ArtifactBlock } from "./artifact-block";
import { useBrainstormActivity } from "@/lib/use-brainstorm-activity";

// Two stacked artifact panes (design.md, spec.md). The outer container
// splits its height evenly; each block has its own independent scroll body
// so a long design can't push the spec out of view.
//
// While the agent is mid-tick (a tool_call is in flight) we dim the pane
// and disable pointer events so the user doesn't fight an in-progress
// `write` from the agent. Final/Diff toggles inside the blocks stay
// reactive — only the pane-level interaction is suppressed.
export function ArtifactPane({
  taskId,
  taskStatus,
  design,
  spec,
  runId,
}: {
  taskId: string;
  taskStatus: TaskStatus;
  design: Artifact | null;
  spec: Artifact | null;
  runId: string | null;
}) {
  const busy = useBrainstormActivity(runId);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className={`flex min-h-0 flex-1 flex-col transition-[opacity,filter] duration-300 ${
          busy ? "pointer-events-none opacity-55 blur-[0.5px]" : ""
        }`}
        aria-busy={busy || undefined}
      >
        <ArtifactBlock
          taskId={taskId}
          taskStatus={taskStatus}
          kind="design"
          artifact={design}
          agentBusy={busy}
        />
        <ArtifactBlock
          taskId={taskId}
          taskStatus={taskStatus}
          kind="spec"
          artifact={spec}
          agentBusy={busy}
        />
      </div>
      {busy && (
        <div
          data-testid="agent-busy-overlay"
          className="pointer-events-none absolute right-3 top-2 rounded border border-st-progress/40 bg-bg/80 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-progress"
        >
          agent editing…
        </div>
      )}
    </div>
  );
}

export { ArtifactPane as EmergingSpec };
