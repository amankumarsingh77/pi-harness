"use client";
import type { Artifact, PlanAgentGraph, Run, Task } from "@pi-harness/shared";
import type { PlanJsonlEvent } from "@/lib/api";
import type { PlanGate } from "@/lib/api";
import { usePlanEvents } from "@/lib/plan-events-context";
import { PlanCanvasConsole } from "./plan-canvas-console";

// Client-side body for the plan page: injects the shared live SSE stream into
// a pure console component. The server page supplies the persisted bundle
// snapshot so first render has plan/scenario/research context; SSE replay then
// fills in raw tool rows and keeps them live.

export function PlanBody({
  task,
  runs,
  gate,
  headerStatus,
  iconKind,
  canCancelRun,
  planEvents,
  plan,
  phasePlans,
  blastRadius,
  scenarios,
  executionDag,
  agentGraph,
  lastBlocked,
}: {
  task: Task;
  runs: readonly Run[];
  gate: PlanGate;
  headerStatus: string;
  iconKind: "intake" | "progress" | "review" | "done" | "blocked";
  canCancelRun: boolean;
  planEvents: PlanJsonlEvent[];
  plan: Artifact | null;
  phasePlans: readonly Artifact[];
  blastRadius: Artifact | null;
  scenarios: Artifact | null;
  executionDag: Artifact | null;
  agentGraph: PlanAgentGraph;
  lastBlocked: { reason: string; ts: string } | null;
}) {
  const { events: liveEvents, connected } = usePlanEvents();

  return (
    <PlanCanvasConsole
      task={task}
      runs={runs}
      gate={gate}
      headerStatus={headerStatus}
      iconKind={iconKind}
      canCancelRun={canCancelRun}
      plan={plan}
      phasePlans={phasePlans}
      blastRadius={blastRadius}
      scenarios={scenarios}
      executionDag={executionDag}
      agentGraph={agentGraph}
      planEvents={planEvents}
      liveEvents={liveEvents}
      connected={connected}
      lastBlocked={lastBlocked}
    />
  );
}
