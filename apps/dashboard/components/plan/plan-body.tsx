"use client";
import { useMemo } from "react";
import {
  derivePlanAgentGraph,
  type AgentEvent,
  type Artifact,
  type PlanAgentGraph,
  type Run,
  type Task,
} from "@pi-harness/shared";
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
  const artifactNames = useMemo(
    () => artifactNamesForPlan({ plan, phasePlans, blastRadius, scenarios, executionDag }),
    [plan, phasePlans, blastRadius, scenarios, executionDag],
  );
  const effectivePlanEvents = useMemo(
    () => mergePlanEvents(planEvents, liveEventsToPlanEvents(liveEvents)),
    [planEvents, liveEvents],
  );
  const effectiveAgentGraph = useMemo(() => {
    if (effectivePlanEvents.length === 0 && artifactNames.length === 0) return agentGraph;
    return derivePlanAgentGraph({ events: effectivePlanEvents, artifactNames });
  }, [agentGraph, artifactNames, effectivePlanEvents]);

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
      agentGraph={effectiveAgentGraph}
      planEvents={effectivePlanEvents}
      liveEvents={liveEvents}
      connected={connected}
      lastBlocked={lastBlocked}
    />
  );
}

function artifactNamesForPlan(input: {
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly blastRadius: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly executionDag: Artifact | null;
}): readonly string[] {
  const names: string[] = [];
  if (input.plan !== null) names.push("plan.md");
  for (const artifact of input.phasePlans) {
    names.push(`plan-${artifact.fm.phase ?? "unknown"}.md`);
  }
  if (input.blastRadius !== null) names.push("blast-radius.yaml");
  if (input.scenarios !== null) names.push("scenarios.yaml");
  if (input.executionDag !== null) names.push("execution-dag.yaml");
  return names;
}

function liveEventsToPlanEvents(events: readonly AgentEvent[]): readonly PlanJsonlEvent[] {
  return events.flatMap((event): readonly PlanJsonlEvent[] => {
    const ts = eventTs(event);
    switch (event.kind) {
      case "plan_system":
        return [{ kind: "plan_system", ts, systemKind: event.systemKind, ...(event.data !== undefined ? { data: event.data } : {}) }];
      case "plan_subagent_started":
        return [{
          kind: "plan_subagent_started",
          ts,
          subagent: event.subagent,
          sessionId: event.sessionId,
          ...(event.attemptId !== undefined ? { attemptId: event.attemptId } : {}),
        }];
      case "plan_subagent_ended":
        return [{
          kind: "plan_subagent_ended",
          ts,
          subagent: event.subagent,
          sessionId: event.sessionId,
          ...(event.attemptId !== undefined ? { attemptId: event.attemptId } : {}),
          ok: event.ok,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.error !== undefined ? { error: event.error } : {}),
        }];
      case "plan_agent_node_started":
        return [{
          kind: "plan_agent_node_started",
          ts,
          nodeId: event.nodeId,
          parentId: event.parentId,
          role: event.role,
          title: event.title,
          lane: event.lane,
          sessionId: event.sessionId,
          model: event.model,
          tools: event.tools,
          ...(event.prompt !== undefined ? { prompt: event.prompt } : {}),
          artifactPath: event.artifactPath,
          dependsOn: event.dependsOn,
        }];
      case "plan_agent_node_findings":
        return [{ kind: "plan_agent_node_findings", ts, nodeId: event.nodeId, body: event.body }];
      case "plan_agent_node_usage":
        return [{
          kind: "plan_agent_node_usage",
          ts,
          nodeId: event.nodeId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
        }];
      case "plan_agent_node_ended":
        return [{
          kind: "plan_agent_node_ended",
          ts,
          nodeId: event.nodeId,
          ok: event.ok,
          status: event.status,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.error !== undefined ? { error: event.error } : {}),
        }];
      case "plan_revision_requested":
        return [{ kind: "plan_revision_requested", ts, comment: event.comment }];
      case "plan_usage":
        return [{
          kind: "plan_usage",
          ts,
          tickIndex: event.tickIndex,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costUsd: event.costUsd,
          cumulativeInputTokens: event.cumulativeInputTokens,
          cumulativeOutputTokens: event.cumulativeOutputTokens,
          cumulativeCostUsd: event.cumulativeCostUsd,
        }];
      case "plan_artifact_edited":
        return [{
          kind: "plan_artifact_edited",
          ts,
          artifact: event.artifact,
          commitSha: event.commitSha,
          sizeDelta: event.sizeDelta,
        }];
      default:
        return [];
    }
  });
}

function mergePlanEvents(
  persisted: readonly PlanJsonlEvent[],
  live: readonly PlanJsonlEvent[],
): readonly PlanJsonlEvent[] {
  const byKey = new Map<string, PlanJsonlEvent>();
  for (const event of persisted) byKey.set(planEventKey(event), event);
  for (const event of live) byKey.set(planEventKey(event), event);
  return [...byKey.values()].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts));
}

function planEventKey(event: PlanJsonlEvent): string {
  switch (event.kind) {
    case "plan_subagent_started":
    case "plan_subagent_ended":
      return `${event.kind}:${event.subagent}:${event.sessionId}:${event.ts}`;
    case "plan_agent_node_started":
    case "plan_agent_node_findings":
    case "plan_agent_node_usage":
    case "plan_agent_node_ended":
      return `${event.kind}:${event.nodeId}:${event.ts}`;
    case "plan_system":
      return `${event.kind}:${event.systemKind}:${event.ts}`;
    case "plan_usage":
      return `${event.kind}:${event.tickIndex}:${event.ts}`;
    case "plan_revision_requested":
      return `${event.kind}:${event.comment}:${event.ts}`;
    case "plan_artifact_edited":
      return `${event.kind}:${event.artifact}:${event.commitSha}:${event.ts}`;
  }
}

function eventTs(event: AgentEvent): string {
  return event.ts instanceof Date ? event.ts.toISOString() : new Date(event.ts).toISOString();
}
