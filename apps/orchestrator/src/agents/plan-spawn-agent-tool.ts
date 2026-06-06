import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type Static, type TSchema } from "typebox";
import type { AgentEvent } from "@pi-harness/shared";
import type { AgentSession, PiBridgeEvent, ToolDefinition } from "@pi-harness/pi-bridge";
import { getSubagent } from "@pi-harness/subagents";
import type { PhaseModelConfig } from "@pi-harness/shared";
import { mkEvent } from "../domain/events.js";
import type { EventStore } from "../adapters/event-store.js";
import type { PlanEventBus } from "./plan-event-bus.js";
import { makeGitHistoryTool } from "./git-history-tool.js";
import { makeWriteFindingsTool } from "./write-findings-tool.js";
import { makeSubagentFooter } from "./subagent-footer.js";
import { makeGraphifyTools } from "./graphify-tools.js";
import type { GraphifyService } from "../services/graphify-service.js";

type ToolResult<T> = {
  readonly content: { readonly type: "text"; readonly text: string }[];
  readonly details: T;
};

type ToolLike<TParams extends TSchema, TDetails> = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TParams;
  readonly execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<ToolResult<TDetails>>;
};

type CreateAgentSessionFn = (opts: {
  cwd: string;
  model: { provider: string; model: string };
  thinkingLevel?: PhaseModelConfig["thinkingLevel"];
  systemPrompt?: string;
  customTools?: ToolDefinition[];
  tools?: string[];
  onEvent: (event: PiBridgeEvent) => void;
}) => Promise<AgentSession>;

const SpawnPlanAgentParams = Type.Object({
  role: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  lane: Type.String({ minLength: 1, maxLength: 60 }),
  instructions: Type.String({ minLength: 1, maxLength: 8000 }),
  dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { default: [] })),
});

export type SpawnPlanAgentDetails =
  | {
      readonly ok: true;
      readonly nodeId: string;
      readonly artifactPath: string;
      readonly costUsd: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
    }
  | {
      readonly ok: false;
      readonly nodeId: string | null;
      readonly error: string;
    };

export function makeSpawnPlanAgentTool(deps: {
  readonly cwd: string;
  readonly taskId: string;
  readonly runId: string;
  readonly phaseModel: PhaseModelConfig;
  readonly bus: PlanEventBus;
  readonly eventStore: EventStore;
  readonly createAgentSession: CreateAgentSessionFn;
  readonly graphify?: GraphifyService;
  readonly graphifyQueryBudget?: number;
  readonly parentSignal?: AbortSignal;
  readonly onUsage: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
}): ToolLike<typeof SpawnPlanAgentParams, SpawnPlanAgentDetails> {
  return {
    name: "spawn_plan_agent",
    label: "Spawn plan agent",
    description:
      "Run a bounded child planning agent from a registered role template. The child writes one findings artifact and streams logs into the plan graph.",
    parameters: SpawnPlanAgentParams,
    async execute(_toolCallId, params, signal) {
      const role = params.role.trim();
      const nodeId = `${slug(role)}-${randomUUID().slice(0, 8)}`;
      try {
        return await runSpawnedPlanAgent({ ...deps, params, nodeId, signal });
      } catch (error) {
        const message = (error as Error).message;
        return {
          content: [{ type: "text", text: `spawn_plan_agent failed: ${message}` }],
          details: { ok: false, nodeId, error: message },
        };
      }
    },
  };
}

async function runSpawnedPlanAgent(args: {
  readonly cwd: string;
  readonly taskId: string;
  readonly runId: string;
  readonly phaseModel: PhaseModelConfig;
  readonly bus: PlanEventBus;
  readonly eventStore: EventStore;
  readonly createAgentSession: CreateAgentSessionFn;
  readonly graphify?: GraphifyService;
  readonly graphifyQueryBudget?: number;
  readonly parentSignal?: AbortSignal;
  readonly onUsage: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
  readonly params: Static<typeof SpawnPlanAgentParams>;
  readonly nodeId: string;
  readonly signal: AbortSignal | undefined;
}): Promise<ToolResult<SpawnPlanAgentDetails>> {
  const def = getSubagent(args.params.role);
  if (def.role !== "plan-research") {
    throw new Error(`role is not planner-spawnable: ${args.params.role}`);
  }

  const sessionId = `psa_${randomUUID()}`;
  const artifactPath = join(args.cwd, ".harness", args.taskId, "research", `${args.nodeId}.md`);
  const startedAt = Date.now();
  const graphifyTools = args.graphify
    ? makeGraphifyTools({
        graphify: args.graphify,
        defaultBudget: args.graphifyQueryBudget ?? 2000,
      })
    : [];
  const customTools = [
    ...(def.customTools?.includes("git_history") ? [makeGitHistoryTool({ cwd: args.cwd })] : []),
    ...(def.customTools?.includes("write_findings")
      ? [makeWriteFindingsTool({ cwd: args.cwd, taskId: args.taskId, subagent: args.nodeId })]
      : []),
    ...graphifyTools,
  ];
  const toolNames = [
    ...def.allowedTools,
    ...(def.customTools?.includes("git_history") ? ["git_history"] : []),
    ...(def.customTools?.includes("write_findings") ? ["write_findings"] : []),
    ...graphifyTools.map((tool) => tool.name),
  ];

  await args.bus.publish({
    kind: "plan_agent_node_started",
    nodeId: args.nodeId,
    parentId: "planner",
    role: def.name,
    title: args.params.title,
    lane: args.params.lane,
    sessionId,
    model: `${args.phaseModel.provider}/${args.phaseModel.model}`,
    tools: toolNames,
    artifactPath,
    dependsOn: args.params.dependsOn ?? ["planner"],
  });

  let session: AgentSession | null = null;
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let ok = false;
  let error: string | undefined;
  const abort = (): void => {
    void session?.abort().catch(() => {});
  };

  args.parentSignal?.addEventListener("abort", abort, { once: true });
  args.signal?.addEventListener("abort", abort, { once: true });
  try {
    session = await args.createAgentSession({
      cwd: args.cwd,
      model: { provider: args.phaseModel.provider, model: args.phaseModel.model },
      ...(args.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: args.phaseModel.thinkingLevel }
        : {}),
      systemPrompt: `${readFileSync(def.promptPath, "utf8")}\n\n${makeSubagentFooter({
        hasGitHistory: def.customTools?.includes("git_history") === true,
      })}\n`,
      tools: toolNames,
      customTools,
      onEvent: (event) => forwardChildEvent({
        eventStore: args.eventStore,
        runId: args.runId,
        taskId: args.taskId,
        nodeId: args.nodeId,
        event,
      }),
    });
    usage = await session.prompt(childPrompt({
      taskId: args.taskId,
      nodeId: args.nodeId,
      artifactPath,
      instructions: args.params.instructions,
    }));
    ok = true;
    args.onUsage(usage);
  } catch (err) {
    error = (err as Error).message;
  } finally {
    args.parentSignal?.removeEventListener("abort", abort);
    args.signal?.removeEventListener("abort", abort);
    await session?.close().catch(() => {});
  }

  await args.bus.publish({
    kind: "plan_agent_node_ended",
    nodeId: args.nodeId,
    ok,
    status: ok ? "succeeded" : "blocked",
    durationMs: Date.now() - startedAt,
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(error !== undefined ? { error } : {}),
  });

  if (!ok) {
    return {
      content: [{ type: "text", text: error ?? "child agent failed" }],
      details: { ok: false, nodeId: args.nodeId, error: error ?? "child agent failed" },
    };
  }

  return {
    content: [{ type: "text", text: `spawned ${args.nodeId}; findings: ${artifactPath}` }],
    details: {
      ok: true,
      nodeId: args.nodeId,
      artifactPath,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}

function forwardChildEvent(args: {
  readonly eventStore: EventStore;
  readonly runId: string;
  readonly taskId: string;
  readonly nodeId: string;
  readonly event: PiBridgeEvent;
}): void {
  if (args.event.kind === "turn_end" || args.event.kind === "error") return;
  const base = { runId: args.runId, taskId: args.taskId };
  let event: AgentEvent | null = null;
  if (args.event.kind === "message_delta") {
    event = mkEvent({ ...base, kind: "message_delta", text: args.event.text, subagent: args.nodeId });
  } else if (args.event.kind === "tool_call") {
    event = mkEvent({
      ...base,
      kind: "tool_call",
      callId: args.event.callId,
      tool: args.event.tool,
      input: args.event.input,
      subagent: args.nodeId,
    });
  } else if (args.event.kind === "tool_result") {
    event = mkEvent({
      ...base,
      kind: "tool_result",
      callId: args.event.callId,
      tool: args.event.tool,
      ok: args.event.ok,
      ...(args.event.output !== undefined ? { output: args.event.output } : {}),
      subagent: args.nodeId,
    });
  } else if (args.event.kind === "log") {
    event = mkEvent({ ...base, kind: "log", level: args.event.level, text: args.event.text, subagent: args.nodeId });
  }
  if (event) void args.eventStore.append(event).catch(() => {});
}

function childPrompt(args: {
  readonly taskId: string;
  readonly nodeId: string;
  readonly artifactPath: string;
  readonly instructions: string;
}): string {
  return [
    `You are a dynamically spawned plan child agent for task ${args.taskId}.`,
    `Node id: ${args.nodeId}.`,
    `Persist findings with write_findings. The harness stores them at ${args.artifactPath}.`,
    "",
    "# Scoped assignment",
    "",
    args.instructions,
    "",
    "Keep findings concise, cite concrete files/lines when available, and do not modify production code.",
  ].join("\n");
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "agent";
}
