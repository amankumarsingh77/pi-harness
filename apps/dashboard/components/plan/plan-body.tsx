"use client";
import { useState, type ReactNode } from "react";
import type { PlanJsonlEvent } from "@/lib/api";
import { PreflightProgress, deriveKind, type DotKind } from "./preflight-progress";
import { AgentDrawer } from "./agent-drawer";
import { PlannerLogPanel } from "./planner-log-panel";
import { usePlanEvents } from "@/lib/plan-events-context";
import type { AgentEvent } from "@pi-harness/shared";

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
  const { events: liveEvents } = usePlanEvents();
  const mergedEvents = mergePlanEvents(events, liveEvents);

  const findingsBody =
    selectedSubagent !== null ? (research[selectedSubagent] ?? null) : null;
  const dotKind: DotKind | null =
    selectedSubagent !== null ? deriveKind(selectedSubagent, research, mergedEvents) : null;

  return (
    <>
      <PreflightProgress
        research={research}
        events={mergedEvents}
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

function mergePlanEvents(initial: PlanJsonlEvent[], live: AgentEvent[]): PlanJsonlEvent[] {
  const projected = live
    .map(projectPlanEvent)
    .filter((event): event is PlanJsonlEvent => event !== null);
  const seen = new Set(initial.map(planEventKey));
  const merged = [...initial];
  for (const event of projected) {
    const key = planEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged.sort((a, b) => a.ts.localeCompare(b.ts));
}

function projectPlanEvent(e: AgentEvent): PlanJsonlEvent | null {
  const ts = e.ts instanceof Date ? e.ts.toISOString() : String(e.ts);
  switch (e.kind) {
    case "plan_system":
      return {
        kind: "plan_system",
        ts,
        systemKind: e.systemKind,
        ...(e.data !== undefined ? { data: e.data } : {}),
      };
    case "plan_subagent_started":
      return { kind: "plan_subagent_started", ts, subagent: e.subagent, sessionId: e.sessionId };
    case "plan_subagent_ended":
      return {
        kind: "plan_subagent_ended",
        ts,
        subagent: e.subagent,
        sessionId: e.sessionId,
        ok: e.ok,
        durationMs: e.durationMs,
        costUsd: e.costUsd,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        ...(e.error !== undefined ? { error: e.error } : {}),
      };
    case "plan_revision_requested":
      return { kind: "plan_revision_requested", ts, comment: e.comment };
    case "plan_usage":
      return {
        kind: "plan_usage",
        ts,
        tickIndex: e.tickIndex,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUsd: e.costUsd,
        cumulativeInputTokens: e.cumulativeInputTokens,
        cumulativeOutputTokens: e.cumulativeOutputTokens,
        cumulativeCostUsd: e.cumulativeCostUsd,
      };
    case "plan_artifact_edited":
      return {
        kind: "plan_artifact_edited",
        ts,
        artifact: e.artifact,
        commitSha: e.commitSha,
        sizeDelta: e.sizeDelta,
      };
    default:
      return null;
  }
}

function planEventKey(e: PlanJsonlEvent): string {
  switch (e.kind) {
    case "plan_system":
      return `${e.kind}:${e.systemKind}:${e.ts}`;
    case "plan_subagent_started":
    case "plan_subagent_ended":
      return `${e.kind}:${e.sessionId}:${e.subagent}:${e.ts}`;
    case "plan_revision_requested":
      return `${e.kind}:${e.ts}`;
    case "plan_usage":
      return `${e.kind}:${e.tickIndex}`;
    case "plan_artifact_edited":
      return `${e.kind}:${e.commitSha}`;
  }
}
