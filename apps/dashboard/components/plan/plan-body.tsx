"use client";
import type { Artifact, PreflightStep, Run, Task } from "@pi-harness/shared";
import type { PlanJsonlEvent } from "@/lib/api";
import type { PlanGate } from "@/lib/api";
import { usePlanEvents } from "@/lib/plan-events-context";
import { PlanConsole } from "./plan-console";

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
  research,
  planEvents,
  preflightSteps,
  plan,
  blastRadius,
  scenarios,
  executionDag,
  plannerLogDefaultOpen,
  lastBlocked,
}: {
  task: Task;
  runs: readonly Run[];
  gate: PlanGate;
  headerStatus: string;
  iconKind: "intake" | "progress" | "review" | "done" | "blocked";
  canCancelRun: boolean;
  research: Record<string, string | null>;
  planEvents: PlanJsonlEvent[];
  preflightSteps: PreflightStep[];
  plan: Artifact | null;
  blastRadius: Artifact | null;
  scenarios: Artifact | null;
  executionDag: Artifact | null;
  plannerLogDefaultOpen: boolean;
  lastBlocked: { reason: string; ts: string } | null;
}) {
  const { events: liveEvents, connected } = usePlanEvents();

  return (
    <PlanConsole
      task={task}
      runs={runs}
      gate={gate}
      headerStatus={headerStatus}
      iconKind={iconKind}
      canCancelRun={canCancelRun}
      plan={plan}
      blastRadius={blastRadius}
      scenarios={scenarios}
      executionDag={executionDag}
      research={research}
      planEvents={planEvents}
      preflightSteps={preflightSteps}
      liveEvents={liveEvents}
      connected={connected}
      plannerLogDefaultOpen={plannerLogDefaultOpen}
      lastBlocked={lastBlocked}
    />
  );
}
