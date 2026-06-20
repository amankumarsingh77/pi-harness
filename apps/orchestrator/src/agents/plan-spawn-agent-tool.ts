import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Type, type Static, type TSchema } from "typebox";
import type { AgentEvent } from "@pi-harness/shared";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { getSubagent } from "@pi-harness/subagents";
import type { PhaseModelConfig } from "@pi-harness/shared";
import { mkEvent } from "../domain/events.js";
import type { EventStore } from "../adapters/event-store.js";
import type { PlanEventBus } from "./plan-event-bus.js";
import { makeGitHistoryTool } from "./git-history-tool.js";
import { makeSubagentFooter } from "./subagent-footer.js";
import { makeGraphifyTools } from "./graphify-tools.js";
import type { GraphifyService } from "../services/graphify-service.js";
import { makeReturnFindingsTool, type ReturnedFindingsState } from "./return-findings-tool.js";
import type {
  AgentSessionOptionsWithoutSessionPath,
  ManagedSessionFactory,
} from "../runner/phase-session-manager.js";

type NodeUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
};

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

type CreateAgentSessionFn = (opts: AgentSessionOptions) => Promise<AgentSession>;

const SpawnPlanAgentParams = Type.Object({
  role: Type.String({ minLength: 1 }),
  title: Type.String({
    minLength: 1,
    maxLength: 120,
    description:
      "Human-readable live display name for this child agent. Use a specific assignment name, not the role or generated id.",
  }),
  lane: Type.String({ minLength: 1, maxLength: 60 }),
  instructions: Type.String({ minLength: 1, maxLength: 8000 }),
  dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { default: [] })),
});

export type SpawnPlanAgentDetails =
  | {
      readonly ok: true;
      readonly nodeId: string;
      readonly artifactPath: null;
      readonly findingsBody: string;
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
  readonly sessionFactory?: ManagedSessionFactory;
  readonly graphify?: GraphifyService;
  readonly graphifyQueryBudget?: number;
  readonly parentSignal?: AbortSignal;
  readonly onUsage: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
}): ToolLike<typeof SpawnPlanAgentParams, SpawnPlanAgentDetails> {
  return {
    name: "spawn_plan_agent",
    label: "Spawn plan agent",
    description:
      "Run a bounded child planning agent from a registered role template. The title is the agent's live display name in the plan graph.",
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
  readonly sessionFactory?: ManagedSessionFactory;
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
  const startedAt = Date.now();
  const findingsState: ReturnedFindingsState = { body: null };
  const graphifyTools = args.graphify
    ? makeGraphifyTools({
        graphify: args.graphify,
        defaultBudget: args.graphifyQueryBudget ?? 2000,
      })
    : [];
  const customTools = [
    ...(def.customTools?.includes("git_history") ? [makeGitHistoryTool({ cwd: args.cwd })] : []),
    makeReturnFindingsTool(findingsState),
    ...graphifyTools,
  ];
  const toolNames = [
    ...def.allowedTools,
    ...(def.customTools?.includes("git_history") ? ["git_history"] : []),
    "return_findings",
    ...graphifyTools.map((tool) => tool.name),
  ];
  const prompt = childPrompt({
    taskId: args.taskId,
    nodeId: args.nodeId,
    instructions: args.params.instructions,
  });

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
    prompt,
    artifactPath: null,
    dependsOn: args.params.dependsOn ?? ["planner"],
  });

  let session: AgentSession | null = null;
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let ok = false;
  let error: string | undefined;
  // Accumulate the child's streamed assistant text so we can fall back to it as the
  // findings body when the child finishes without calling return_findings.
  const assistantText: string[] = [];
  let findingsBody: string | null = null;
  const publishUsage = createNodeUsageForwarder({
    bus: args.bus,
    nodeId: args.nodeId,
    minIntervalMs: 1_500,
  });
  const abort = (): void => {
    void session?.abort().catch(() => {});
  };

  args.parentSignal?.addEventListener("abort", abort, { once: true });
  args.signal?.addEventListener("abort", abort, { once: true });
  try {
    const sessionOpts: AgentSessionOptionsWithoutSessionPath = {
      cwd: args.cwd,
      model: { provider: args.phaseModel.provider, model: args.phaseModel.model },
      ...(args.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: args.phaseModel.thinkingLevel }
        : {}),
      systemPrompt: `${readFileSync(def.promptPath, "utf8")}\n\n${makeSubagentFooter({
        hasGitHistory: def.customTools?.includes("git_history") === true,
        findingsMode: "return",
      })}\n`,
      tools: toolNames,
      customTools,
      onEvent: (event) => {
        if (event.kind === "message_delta") assistantText.push(event.text);
        forwardChildEvent({
          eventStore: args.eventStore,
          runId: args.runId,
          taskId: args.taskId,
          nodeId: args.nodeId,
          event,
          publishUsage,
        });
      },
    };
    session = args.sessionFactory
      ? await args.sessionFactory.open({ kind: "plan-child", nodeId: args.nodeId }, sessionOpts)
      : await args.createAgentSession(sessionOpts);
    usage = await session.prompt(prompt);
    findingsBody = resolveFindingsBody(findingsState.body, assistantText.join(""));
    if (findingsBody === null) {
      throw new Error("child agent completed without returning findings");
    }
    ok = true;
    args.onUsage(usage);
  } catch (err) {
    error = (err as Error).message;
  } finally {
    args.parentSignal?.removeEventListener("abort", abort);
    args.signal?.removeEventListener("abort", abort);
    await session?.close().catch(() => {});
  }

  if (!ok) {
    await publishNodeEnded({
      bus: args.bus,
      nodeId: args.nodeId,
      ok: false,
      status: "blocked",
      startedAt,
      usage,
      ...(error !== undefined ? { error } : {}),
    });
    return {
      content: [{ type: "text", text: error ?? "child agent failed" }],
      details: { ok: false, nodeId: args.nodeId, error: error ?? "child agent failed" },
    };
  }

  // ok === true guarantees findingsBody was resolved above; this narrows the type.
  if (findingsBody === null) {
    return {
      content: [{ type: "text", text: "child agent completed without returning findings" }],
      details: {
        ok: false,
        nodeId: args.nodeId,
        error: "child agent completed without returning findings",
      },
    };
  }

  await args.bus.publish({
    kind: "plan_agent_node_findings",
    nodeId: args.nodeId,
    body: findingsBody,
  });
  await publishNodeEnded({
    bus: args.bus,
    nodeId: args.nodeId,
    ok: true,
    status: "succeeded",
    startedAt,
    usage,
  });

  return {
    content: [
      {
        type: "text",
        text: [`spawned ${args.nodeId}; findings returned directly:`, "", findingsBody].join("\n"),
      },
    ],
    details: {
      ok: true,
      nodeId: args.nodeId,
      artifactPath: null,
      findingsBody,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    },
  };
}

async function publishNodeEnded(args: {
  readonly bus: PlanEventBus;
  readonly nodeId: string;
  readonly ok: boolean;
  readonly status: "succeeded" | "failed" | "blocked" | "cancelled";
  readonly startedAt: number;
  readonly usage: { readonly costUsd: number; readonly inputTokens: number; readonly outputTokens: number };
  readonly error?: string;
}): Promise<void> {
  await args.bus.publish({
    kind: "plan_agent_node_ended",
    nodeId: args.nodeId,
    ok: args.ok,
    status: args.status,
    durationMs: Date.now() - args.startedAt,
    costUsd: args.usage.costUsd,
    inputTokens: args.usage.inputTokens,
    outputTokens: args.usage.outputTokens,
    ...(args.error !== undefined ? { error: args.error } : {}),
  });
}

function forwardChildEvent(args: {
  readonly eventStore: EventStore;
  readonly runId: string;
  readonly taskId: string;
  readonly nodeId: string;
  readonly event: PiBridgeEvent;
  readonly publishUsage: (usage: NodeUsage) => void;
}): void {
  if (args.event.kind === "usage_update") {
    args.publishUsage(args.event.usage);
    return;
  }
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

function createNodeUsageForwarder(args: {
  readonly bus: PlanEventBus;
  readonly nodeId: string;
  readonly minIntervalMs: number;
}): (usage: NodeUsage) => void {
  let lastPublishedAt = 0;
  let lastUsage: NodeUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return (usage) => {
    if (!hasUsage(usage) || sameUsage(usage, lastUsage)) return;
    const now = Date.now();
    if (lastPublishedAt > 0 && now - lastPublishedAt < args.minIntervalMs) return;
    lastPublishedAt = now;
    lastUsage = usage;
    void args.bus.publish({
      kind: "plan_agent_node_usage",
      nodeId: args.nodeId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
    }).catch(() => {});
  };
}

function hasUsage(usage: NodeUsage): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || usage.costUsd > 0;
}

function sameUsage(left: NodeUsage, right: NodeUsage): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.outputTokens === right.outputTokens &&
    left.costUsd === right.costUsd
  );
}

// Prefer the structured return_findings body; fall back to the child's final assistant
// message. Returns null only when BOTH are empty.
function resolveFindingsBody(returned: string | null, message: string): string | null {
  if (returned !== null && returned.trim().length > 0) return returned;
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function childPrompt(args: {
  readonly taskId: string;
  readonly nodeId: string;
  readonly instructions: string;
}): string {
  return [
    `You are a dynamically spawned plan child agent for task ${args.taskId}.`,
    `Node id: ${args.nodeId}.`,
    "Return findings to the parent planner by calling return_findings (preferred). If you instead end with your findings as your final message, that will be used. Do not write a findings artifact.",
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
