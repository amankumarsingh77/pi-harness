import { describe, expect, it } from "vitest";
import type { PlanAgentGraphNode } from "@pi-harness/shared";
import { derivePlanAgentGraph } from "./plan-agent-graph.js";

describe("derivePlanAgentGraph", () => {
  it("projects dynamic plan agent nodes, edges, and totals", () => {
    const graph = derivePlanAgentGraph({
      events: [
        {
          kind: "plan_system",
          ts: "2026-06-01T10:00:00.000Z",
          systemKind: "planner_started",
        },
        {
          kind: "plan_agent_node_started",
          ts: "2026-06-01T10:00:05.000Z",
          nodeId: "agent-1",
          parentId: "planner",
          role: "codebase-scout",
          title: "Scout codebase",
          lane: "local",
          sessionId: "s1",
          model: "crofai/kimi-k2.6",
          tools: ["read", "grep", "write_findings"],
          prompt: "Find dashboard plan files.",
          artifactPath: ".harness/T-1/research/agent-1.md",
          dependsOn: ["planner"],
        },
        {
          kind: "plan_agent_node_ended",
          ts: "2026-06-01T10:01:05.000Z",
          nodeId: "agent-1",
          ok: true,
          status: "succeeded",
          durationMs: 60_000,
          costUsd: 0.04,
          inputTokens: 1200,
          outputTokens: 400,
        },
      ],
      artifactNames: ["plan.md"],
    });

    expect(graph.nodes.map((node: PlanAgentGraphNode) => node.id)).toEqual([
      "planner",
      "agent-1",
      "artifact:plan.md",
    ]);
    expect(graph.nodes.find((node: PlanAgentGraphNode) => node.id === "agent-1")).toMatchObject({
      status: "succeeded",
      costUsd: 0.04,
      inputTokens: 1200,
      outputTokens: 400,
      prompt: "Find dashboard plan files.",
    });
    expect(graph.edges).toEqual([
      { id: "planner->agent-1:spawn", source: "planner", target: "agent-1", kind: "spawn" },
      { id: "planner->agent-1:depends_on", source: "planner", target: "agent-1", kind: "depends_on" },
      { id: "planner->artifact:plan.md:artifact", source: "planner", target: "artifact:plan.md", kind: "artifact" },
    ]);
    expect(graph.totals).toEqual({ costUsd: 0.04, inputTokens: 1200, outputTokens: 400 });
  });

  it("preserves dynamic nodes that return findings without artifact paths", () => {
    const graph = derivePlanAgentGraph({
      events: [
        {
          kind: "plan_agent_node_started",
          ts: "2026-06-01T10:00:05.000Z",
          nodeId: "agent-1",
          parentId: "planner",
          role: "codebase-scout",
          title: "Scout codebase",
          lane: "local",
          sessionId: "s1",
          model: "crofai/kimi-k2.6",
          tools: ["read", "grep", "return_findings"],
          artifactPath: null,
          dependsOn: ["planner"],
        },
      ],
      artifactNames: [],
    });

    expect(graph.nodes.find((node: PlanAgentGraphNode) => node.id === "agent-1")).toMatchObject({
      artifactPath: null,
      tools: ["read", "grep", "return_findings"],
    });
  });

  it("updates running dynamic nodes from live usage events", () => {
    const graph = derivePlanAgentGraph({
      events: [
        {
          kind: "plan_agent_node_started",
          ts: "2026-06-01T10:00:05.000Z",
          nodeId: "agent-1",
          parentId: "planner",
          role: "codebase-scout",
          title: "Scout codebase",
          lane: "local",
          sessionId: "s1",
          model: "crofai/kimi-k2.6",
          tools: ["read", "grep", "return_findings"],
          artifactPath: null,
          dependsOn: ["planner"],
        },
        {
          kind: "plan_agent_node_usage",
          ts: "2026-06-01T10:00:20.000Z",
          nodeId: "agent-1",
          inputTokens: 900,
          outputTokens: 150,
          costUsd: 0.018,
        },
      ],
      artifactNames: [],
    });

    expect(graph.nodes.find((node: PlanAgentGraphNode) => node.id === "agent-1")).toMatchObject({
      status: "running",
      costUsd: 0.018,
      inputTokens: 900,
      outputTokens: 150,
    });
    expect(graph.totals).toEqual({ costUsd: 0.018, inputTokens: 900, outputTokens: 150 });
  });

  it("uses plan_usage cumulative totals when available", () => {
    const graph = derivePlanAgentGraph({
      events: [
        {
          kind: "plan_usage",
          ts: "2026-06-01T10:03:00.000Z",
          tickIndex: 1,
          inputTokens: 10,
          outputTokens: 20,
          costUsd: 0.01,
          cumulativeInputTokens: 5000,
          cumulativeOutputTokens: 3000,
          cumulativeCostUsd: 0.22,
        },
      ],
      artifactNames: [],
    });

    expect(graph.totals).toEqual({ costUsd: 0.22, inputTokens: 5000, outputTokens: 3000 });
  });

  it("projects legacy plan_subagent events for archived runs", () => {
    const graph = derivePlanAgentGraph({
      events: [
        {
          kind: "plan_subagent_started",
          ts: "2026-06-01T10:00:05.000Z",
          subagent: "integration-scanner",
          sessionId: "legacy-1",
        },
        {
          kind: "plan_subagent_ended",
          ts: "2026-06-01T10:00:35.000Z",
          subagent: "integration-scanner",
          sessionId: "legacy-1",
          ok: false,
          durationMs: 30_000,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "timed out",
        },
      ],
      artifactNames: [],
    });

    expect(
      graph.nodes.find((node: PlanAgentGraphNode) => node.id === "integration-scanner"),
    ).toMatchObject({
      parentId: "planner",
      status: "blocked",
      error: "timed out",
    });
  });
});
