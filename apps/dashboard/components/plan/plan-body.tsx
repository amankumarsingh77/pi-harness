"use client";
import type { Artifact, Run, Task } from "@pi-harness/shared";
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
  research,
  planEvents,
  plan,
  blastRadius,
  scenarios,
  plannerLogDefaultOpen,
}: {
  task: Task;
  runs: readonly Run[];
  gate: PlanGate;
  headerStatus: string;
  iconKind: "intake" | "progress" | "review" | "done" | "blocked";
  research: Record<string, string | null>;
  planEvents: PlanJsonlEvent[];
  plan: Artifact | null;
  blastRadius: Artifact | null;
  scenarios: Artifact | null;
  plannerLogDefaultOpen: boolean;
}) {
  const { events: liveEvents, connected } = usePlanEvents();

  return (
    <PlanConsole
      task={task}
      runs={runs}
      gate={gate}
      headerStatus={headerStatus}
      iconKind={iconKind}
      plan={plan}
      blastRadius={blastRadius}
      scenarios={scenarios}
      research={research}
      planEvents={planEvents}
      liveEvents={liveEvents}
      connected={connected}
      plannerLogDefaultOpen={plannerLogDefaultOpen}
    />
  );
}
