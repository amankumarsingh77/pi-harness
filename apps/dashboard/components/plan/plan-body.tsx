"use client";
import { useState, type ReactNode } from "react";
import type { PlanJsonlEvent } from "@/lib/api";
import { PreflightProgress, deriveKind, type DotKind } from "./preflight-progress";
import { AgentDrawer } from "./agent-drawer";
import { PlannerLogPanel } from "./planner-log-panel";

// Client-side body for the plan page: owns `selectedSubagent` state, mounts
// the per-agent drawer, and renders the bottom planner log panel. Server
// component (page.tsx) renders the artifact columns as `children` so this
// stays a thin client shell.

export function PlanBody({
  research,
  events,
  artifactsBody,
  plannerLogDefaultOpen,
}: {
  research: Record<string, string | null>;
  events: PlanJsonlEvent[];
  artifactsBody: ReactNode;
  plannerLogDefaultOpen: boolean;
}) {
  const [selectedSubagent, setSelectedSubagent] = useState<string | null>(null);

  const findingsBody =
    selectedSubagent !== null ? (research[selectedSubagent] ?? null) : null;
  const dotKind: DotKind | null =
    selectedSubagent !== null ? deriveKind(selectedSubagent, research, events) : null;

  return (
    <>
      <PreflightProgress
        research={research}
        events={events}
        selectedSubagent={selectedSubagent}
        onSelect={(s) => setSelectedSubagent((curr) => (curr === s ? null : s))}
      />

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_460px] overflow-hidden data-[no-drawer=true]:grid-cols-[minmax(0,1fr)]"
            data-no-drawer={selectedSubagent === null}>
        <div className="grid min-h-0 grid-cols-[1.4fr_1fr] overflow-hidden">
          {artifactsBody}
        </div>
        {selectedSubagent !== null && dotKind !== null && (
          <AgentDrawer
            subagent={selectedSubagent}
            findingsBody={findingsBody}
            status={dotKind}
            onClose={() => setSelectedSubagent(null)}
          />
        )}
      </main>

      <PlannerLogPanel defaultOpen={plannerLogDefaultOpen} />
    </>
  );
}
