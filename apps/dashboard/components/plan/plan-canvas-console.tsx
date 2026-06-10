"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import type {
  AgentEvent,
  Artifact,
  PlanAgentGraph,
  PlanAgentGraphNode,
  Run,
  Task,
} from "@pi-harness/shared";
import { approvePlan, requestPlanChanges } from "@/app/tasks/[id]/plan/actions";
import type { PlanGate, PlanJsonlEvent } from "@/lib/api";
import { CancelPhaseRunButton } from "@/components/task-detail/cancel-phase-run-button";
import { StatusIcon } from "@/components/kanban/status-icon";
import { buildLogRows, type LogRow } from "./plan-log-rows";
import { RestartPlanButton } from "./restart-plan-button";

type PlanCanvasNodeData = Record<string, unknown> & {
  readonly graphNode: PlanAgentGraphNode;
};
type PlanCanvasFlowNode = FlowNode<PlanCanvasNodeData, "plan-node">;

const nodeTypes: NodeTypes = {
  "plan-node": PlanCanvasNode,
};

export function PlanCanvasConsole({
  task,
  runs,
  gate,
  headerStatus,
  iconKind,
  canCancelRun,
  plan,
  phasePlans,
  blastRadius,
  scenarios,
  executionDag,
  agentGraph,
  planEvents,
  liveEvents,
  connected,
  lastBlocked,
}: {
  readonly task: Task;
  readonly runs: readonly Run[];
  readonly gate: PlanGate;
  readonly headerStatus: string;
  readonly iconKind: "intake" | "progress" | "review" | "done" | "blocked";
  readonly canCancelRun: boolean;
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly blastRadius: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly executionDag: Artifact | null;
  readonly agentGraph: PlanAgentGraph;
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly connected: boolean;
  readonly lastBlocked: { reason: string; ts: string } | null;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState("planner");
  const selectedNode =
    agentGraph.nodes.find((node) => node.id === selectedNodeId) ??
    agentGraph.nodes[0] ??
    null;
  const flow = useMemo(() => layoutGraph(agentOnlyGraph(agentGraph)), [agentGraph]);
  const planRun = [...runs].reverse().find((run) => run.phase === "plan") ?? null;
  const canRestart =
    task.status === "plan_failed" ||
    (task.status === "planning" &&
      (planRun?.status === "running" || planRun?.status === "cancelled"));
  const agentCount = agentGraph.nodes.filter((node) => node.kind === "agent").length;
  const runningCount = agentGraph.nodes.filter((node) => node.status === "running").length;
  const artifactCount = [
    plan,
    ...phasePlans,
    blastRadius,
    scenarios,
    executionDag,
  ].filter(Boolean).length;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <header className="border-b border-line bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <nav
              aria-label="Breadcrumb"
              className="mb-1 flex items-center gap-1.5 font-mono text-[11px] text-fg-mute"
            >
              <Link href="/" className="transition-colors hover:text-fg-body">
                Board
              </Link>
              <span className="text-fg-faint">/</span>
              <Link href={`/tasks/${task.id}` as never} className="text-fg-body hover:text-fg">
                {task.id}
              </Link>
              <span className="text-fg-faint">/</span>
              <span className="text-st-review">plan</span>
            </nav>
            <div className="flex min-w-0 items-center gap-2">
              <StatusIcon kind={iconKind} size={14} live={iconKind === "progress"} />
              <h1 className="truncate text-[18px] font-semibold leading-tight text-fg">
                {task.title}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SummaryPill label="cost" value={`$${agentGraph.totals.costUsd.toFixed(3)}`} />
            <SummaryPill label="in" value={formatCompact(agentGraph.totals.inputTokens)} />
            <SummaryPill label="out" value={formatCompact(agentGraph.totals.outputTokens)} />
            <SummaryPill label="stream" value={connected ? "live" : "replay"} />
            <SummaryPill label="gate" value={gate} />
            {canCancelRun && (
              <CancelPhaseRunButton taskId={task.id} phase="plan" disabled={false} />
            )}
            <RestartPlanButton taskId={task.id} disabled={!canRestart} />
          </div>
        </div>
        {lastBlocked && (
          <div
            role="alert"
            data-testid="plan-blocked-banner"
            className="mt-3 rounded-[8px] border border-st-blocked/40 bg-st-blocked/[0.07] px-3 py-2 font-mono text-[12px] text-fg-body"
          >
            <span className="text-st-blocked">blocked</span>
            <span className="text-fg-mute"> · </span>
            {lastBlocked.reason || "no reason recorded"}
          </div>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)_380px]">
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-card/70 p-3">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <MiniStat label="agents" value={agentCount} />
            <MiniStat label="running" value={runningCount} />
            <MiniStat label="files" value={artifactCount} />
          </div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
            hierarchy
          </div>
          <div className="grid gap-1.5">
            {agentGraph.nodes
              .filter((node) => node.kind !== "artifact")
              .map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left transition-colors ${
                    selectedNode?.id === node.id
                      ? "border-st-progress/60 bg-st-progress/10"
                      : "border-line bg-white/[0.015] hover:border-line-hover hover:bg-white/[0.035]"
                  }`}
                >
                  <StatusDot status={node.status} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-fg-body">
                      {node.title}
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-fg-mute">
                      {node.role}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-fg-faint">{node.lane}</span>
                </button>
              ))}
          </div>
        </aside>

        <section className="relative min-h-0 overflow-hidden" aria-label="Plan graph canvas">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-[8px] border border-line bg-card/90 px-2.5 py-1.5 shadow-xl shadow-black/20">
            <Boxes size={14} className="text-st-progress" />
            <span className="font-mono text-[11px] text-fg-mute">{headerStatus}</span>
          </div>
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.35}
            maxZoom={1.4}
            nodesDraggable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            className="bg-bg"
          >
            <Background color="rgba(255,255,255,0.08)" gap={28} size={1} />
            <Controls className="!border-line !bg-card !shadow-none [&_button]:!border-line [&_button]:!bg-card [&_button]:!text-fg-body" />
          </ReactFlow>
        </section>

        <AgentInspector
          node={selectedNode}
          artifacts={{ plan, phasePlans, blastRadius, scenarios, executionDag }}
          planEvents={planEvents}
          liveEvents={liveEvents}
          gate={gate}
          taskStatus={task.status}
          taskId={task.id}
        />
      </div>
    </main>
  );
}

function PlanCanvasNode({ data }: NodeProps<PlanCanvasFlowNode>) {
  const node = data.graphNode;
  return (
    <div className="min-w-[210px] max-w-[260px] rounded-[8px] border border-line bg-card px-3 py-2.5 shadow-2xl shadow-black/25">
      <Handle type="target" position={Position.Top} className="!border-line !bg-fg-faint" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={node.status} />
            <span className="truncate text-[13px] font-semibold text-fg">{node.title}</span>
          </div>
          <div className="mt-1 truncate font-mono text-[10.5px] text-fg-mute">{node.role}</div>
        </div>
        <NodeIcon kind={node.kind} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[10px] text-fg-mute">
        <span>{node.lane}</span>
        <span>{formatCompact(node.inputTokens)} in</span>
        <span>${node.costUsd.toFixed(3)}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!border-line !bg-fg-faint" />
    </div>
  );
}

function AgentInspector({
  node,
  artifacts,
  planEvents,
  liveEvents,
  gate,
  taskStatus,
  taskId,
}: {
  readonly node: PlanAgentGraphNode | null;
  readonly artifacts: {
    readonly plan: Artifact | null;
    readonly phasePlans: readonly Artifact[];
    readonly blastRadius: Artifact | null;
    readonly scenarios: Artifact | null;
    readonly executionDag: Artifact | null;
  };
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly gate: PlanGate;
  readonly taskStatus: Task["status"];
  readonly taskId: string;
}) {
  const [tab, setTab] = useState<"overview" | "logs" | "artifacts">("overview");
  const nodeEvents = useMemo(
    () => filterEventsForNode(liveEvents, node?.id ?? "planner"),
    [liveEvents, node?.id],
  );
  const rows = useMemo(() => buildLogRows(nodeEvents), [nodeEvents]);

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-card/85">
      <header className="border-b border-line p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
              agent info
            </div>
            <h2 className="mt-1 truncate text-[17px] font-semibold text-fg">
              {node?.title ?? "No node selected"}
            </h2>
            <div className="mt-1 font-mono text-[11px] text-fg-mute">
              {node?.role ?? "select a node"}
            </div>
          </div>
          {node && <StatusDot status={node.status} />}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-[7px] border border-line bg-bg p-1">
          {(["overview", "logs", "artifacts"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-[5px] px-2 py-1.5 text-[12px] capitalize ${
                tab === item ? "bg-card-hover text-fg" : "text-fg-mute hover:text-fg-body"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      <div className="scroll-hide min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "overview" && node && (
          <OverviewTab node={node} planEvents={planEvents} rawEvents={nodeEvents} />
        )}
        {tab === "logs" && (
          <LogsTab
            rows={rows}
            rawEvents={nodeEvents}
            planEvents={planEvents}
            nodeId={node?.id ?? "planner"}
            nodeTitle={node?.title ?? "Planner"}
          />
        )}
        {tab === "artifacts" && (
          <ArtifactsTab artifacts={artifacts} node={node} planEvents={planEvents} />
        )}
      </div>

      <footer className="border-t border-line p-3">
        <PlanApprovalActions taskId={taskId} gate={gate} taskStatus={taskStatus} />
      </footer>
    </aside>
  );
}

function OverviewTab({
  node,
  planEvents,
  rawEvents,
}: {
  readonly node: PlanAgentGraphNode;
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly rawEvents: readonly AgentEvent[];
}) {
  const isRunning = node.status === "running";
  const nowMs = useNowMs(isRunning && node.startedAt !== null);
  const runtimeMs = isRunning ? runningDurationMs(node, nowMs) : node.durationMs;
  const lifecycleRows = planEvents.filter((event) => isPlanNodeEvent(event, node.id)).slice(-5);
  const activity = summarizeRawEvents(rawEvents);
  const latestLifecycle = lifecycleRows.at(-1);
  const timingRows = [
    info("started", formatDateTime(node.startedAt)),
    info("ended", formatDateTime(node.endedAt)),
    info(isRunning ? "runtime so far" : "runtime", formatDuration(runtimeMs)),
  ];

  return (
    <div className="grid gap-3">
      <section className="grid grid-cols-2 gap-2">
        <MetricTile label={isRunning ? "runtime so far" : "runtime"} value={formatDuration(runtimeMs)} />
        <MetricTile label={isRunning ? "cost so far" : "cost"} value={`$${node.costUsd.toFixed(4)}`} />
        <MetricTile label={isRunning ? "tokens in so far" : "tokens in"} value={node.inputTokens.toLocaleString()} />
        <MetricTile label={isRunning ? "tokens out so far" : "tokens out"} value={node.outputTokens.toLocaleString()} />
      </section>

      <OverviewSection title="assignment">
        <InfoRow label="status" value={node.status} />
        <InfoRow label="role" value={node.role} />
        <InfoRow label="lane" value={node.lane} />
        <InfoRow label="parent" value={node.parentId ?? "-"} />
        <InfoRow label="depends on" value={joinOrDash(node.dependsOn)} />
      </OverviewSection>

      <OverviewSection title="execution">
        <InfoRow label="model" value={node.model ?? "-"} />
        <InfoRow label="session" value={node.sessionId ?? "-"} />
        {timingRows.map((row) => (
          <InfoRow key={row.label} label={row.label} value={row.value} />
        ))}
        <InfoRow label="artifact" value={node.artifactPath ?? "-"} />
      </OverviewSection>

      <OverviewSection title="tools">
        {node.tools.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {node.tools.map((tool) => (
              <span key={tool} className="rounded-[5px] border border-line bg-bg px-2 py-1 font-mono text-[10.5px] text-fg-body">
                {tool}
              </span>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[11.5px] text-fg-mute">no tools registered</p>
        )}
      </OverviewSection>

      <OverviewSection title="activity">
        <div className="grid grid-cols-3 gap-2">
          <MetricTile label="messages" value={activity.messages.toLocaleString()} compact />
          <MetricTile label="tool calls" value={activity.toolCalls.toLocaleString()} compact />
          <MetricTile label="results" value={activity.toolResults.toLocaleString()} compact />
        </div>
        <InfoRow label="latest" value={latestLifecycle ? describePlanEvent(latestLifecycle, node.title) : "-"} />
      </OverviewSection>

      {node.error && <div className="rounded-[7px] border border-st-blocked/40 bg-st-blocked/[0.07] p-2 font-mono text-[11.5px] text-st-blocked">{node.error}</div>}
    </div>
  );
}

function LogsTab({
  rows,
  rawEvents,
  planEvents,
  nodeId,
  nodeTitle,
}: {
  readonly rows: readonly LogRow[];
  readonly rawEvents: readonly AgentEvent[];
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly nodeId: string;
  readonly nodeTitle: string;
}) {
  const lifecycleRows = planEvents.filter((event) => isPlanNodeEvent(event, nodeId)).slice(-8);
  return (
    <div className="grid gap-3">
      <section>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
          live tool calls
        </div>
        <ExpandableLogRows rows={rows} rawEvents={rawEvents} />
      </section>
      {lifecycleRows.length > 0 && (
        <section>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
            lifecycle
          </div>
          <div className="grid gap-1.5">
            {lifecycleRows.map((event) => (
              <div key={`${event.kind}:${event.ts}`} className="rounded-[6px] border border-line bg-bg px-2 py-1.5 font-mono text-[11px] text-fg-body">
                <span className="text-fg-mute">{event.ts.slice(11, 19)}</span>
                <span className="text-fg-faint"> · </span>
                {describePlanEvent(event, nodeTitle)}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ArtifactsTab({
  artifacts,
  node,
  planEvents,
}: {
  readonly artifacts: {
    readonly plan: Artifact | null;
    readonly phasePlans: readonly Artifact[];
    readonly blastRadius: Artifact | null;
    readonly scenarios: Artifact | null;
    readonly executionDag: Artifact | null;
  };
  readonly node: PlanAgentGraphNode | null;
  readonly planEvents: readonly PlanJsonlEvent[];
}) {
  const findings = latestFindingsForNode(planEvents, node?.id ?? null);
  const items = [
    artifactItem("plan.md", artifacts.plan),
    ...artifacts.phasePlans.map((artifact) => artifactItem(`plan-${artifact.fm.phase ?? "?"}.md`, artifact)),
    artifactItem("blast-radius.yaml", artifacts.blastRadius),
    artifactItem("scenarios.yaml", artifacts.scenarios),
    artifactItem("execution-dag.yaml", artifacts.executionDag),
  ].filter((item): item is { name: string; artifact: Artifact } => item !== null);

  return (
    <div className="grid gap-2">
      {findings && (
        <div className="rounded-[7px] border border-line bg-bg p-2">
          <div className="font-mono text-[11.5px] text-fg-mute">returned findings</div>
          <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.55] text-fg-body">
            {truncate(findings.body, 6000)}
          </pre>
        </div>
      )}
      {node?.artifactPath && (
        <div className="rounded-[7px] border border-line bg-bg p-2 font-mono text-[11.5px] text-fg-body">
          <div className="text-fg-mute">node artifact</div>
          <div className="mt-1 break-words">{node.artifactPath}</div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="font-mono text-[11.5px] text-fg-mute">no artifacts yet</p>
      ) : (
        items.map((item) => (
          <details key={item.name} className="rounded-[7px] border border-line bg-bg">
            <summary className="cursor-pointer px-2.5 py-2 text-[12px] font-medium text-fg-body">
              {item.name}
              <span className="ml-2 font-mono text-[10.5px] text-fg-mute">{item.artifact.fm.status}</span>
            </summary>
            <pre className="max-h-[280px] overflow-auto border-t border-line p-2.5 font-mono text-[11px] leading-[1.55] text-fg-body">
              {truncate(item.artifact.body, 6000)}
            </pre>
          </details>
        ))
      )}
    </div>
  );
}

function ExpandableLogRows({
  rows,
  rawEvents,
}: {
  readonly rows: readonly LogRow[];
  readonly rawEvents: readonly AgentEvent[];
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const visibleRows = rows.slice(-80);

  if (visibleRows.length === 0) {
    return <p className="font-mono text-[11.5px] text-fg-mute">no tool calls yet</p>;
  }

  return (
    <div className="grid gap-1.5 font-mono text-[11.5px]">
      {visibleRows.map((row) => {
        const expanded = openRow === row.id;
        return (
          <div key={row.id} className="rounded-[6px] border border-line bg-bg">
            <button
              type="button"
              onClick={() => setOpenRow(expanded ? null : row.id)}
              className="grid w-full grid-cols-[14px_54px_52px_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-left"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="text-fg-faint">{formatTime(row.ts)}</span>
              <span className={logToneClass(row.tone)}>{row.verb}</span>
              <span className="truncate text-fg-body">{row.detail || "-"}</span>
            </button>
            {expanded && (
              <pre
                data-testid="expanded-log-details"
                className="scroll-hide max-h-[220px] overflow-auto border-t border-line p-2 text-[10.5px] leading-[1.5] text-fg-mute"
              >
                {JSON.stringify(rawEvents.slice(-8).map(serializeEvent), null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlanApprovalActions({
  taskId,
  gate,
  taskStatus,
}: {
  readonly taskId: string;
  readonly gate: PlanGate;
  readonly taskStatus: Task["status"];
}) {
  const [pending, startTransition] = useTransition();
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enabled = gate === "awaiting_user" && taskStatus === "planning";

  function approve(): void {
    setError(null);
    startTransition(async () => {
      try {
        await approvePlan(taskId);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function requestChanges(): void {
    setError(null);
    startTransition(async () => {
      try {
        await requestPlanChanges(taskId, comment);
        setComment("");
        setShowComment(false);
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  if (showComment) {
    return (
      <div className="grid gap-2">
        <textarea
          className="min-h-[72px] w-full resize-none rounded-[7px] border border-line bg-input p-2 font-mono text-[12px] text-fg outline-none focus:border-line-hover"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          disabled={pending}
          placeholder="What should change?"
        />
        {error && <span className="font-mono text-[11px] text-st-blocked">{error}</span>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border border-line px-2.5 py-1.5 text-[12px] text-fg-body" onClick={() => setShowComment(false)} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="rounded bg-st-blocked px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" onClick={requestChanges} disabled={pending || comment.trim().length < 10}>
            Send revision
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {error && <span className="font-mono text-[11px] text-st-blocked">{error}</span>}
      <button type="button" className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-[12px] text-fg-body disabled:opacity-50" onClick={() => setShowComment(true)} disabled={!enabled || pending}>
        <Pause size={13} /> Request changes
      </button>
      <button type="button" className="inline-flex items-center gap-1.5 rounded bg-st-progress px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" onClick={approve} disabled={!enabled || pending}>
        <Play size={13} /> Approve
      </button>
    </div>
  );
}

function layoutGraph(graph: PlanAgentGraph): { nodes: PlanCanvasFlowNode[]; edges: FlowEdge[] } {
  const levels = new Map<string, number>([["planner", 0]]);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visit = (node: PlanAgentGraphNode): number => {
    const cached = levels.get(node.id);
    if (cached !== undefined) return cached;
    if (!node.parentId) {
      levels.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    const level = parent ? visit(parent) + 1 : 1;
    levels.set(node.id, level);
    return level;
  };
  graph.nodes.forEach(visit);
  const groups = new Map<number, PlanAgentGraphNode[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), node]);
  }

  const nodes = graph.nodes.map((node): PlanCanvasFlowNode => {
    const level = levels.get(node.id) ?? 0;
    const siblings = groups.get(level) ?? [node];
    const index = siblings.findIndex((item) => item.id === node.id);
    const width = Math.max(1, siblings.length - 1) * 300;
    return {
      id: node.id,
      type: "plan-node",
      position: { x: index * 300 - width / 2, y: level * 190 },
      data: { graphNode: node },
    };
  });

  const edges = graph.edges.map((edge): FlowEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: edge.kind === "spawn",
    style: {
      stroke:
        edge.kind === "artifact"
          ? "rgba(76,183,130,0.75)"
          : edge.kind === "depends_on"
            ? "rgba(242,201,76,0.72)"
            : "rgba(94,106,210,0.8)",
      strokeWidth: 1.6,
    },
  }));

  return { nodes, edges };
}

function agentOnlyGraph(graph: PlanAgentGraph): PlanAgentGraph {
  const nodes = graph.nodes.filter((node) => node.kind !== "artifact");
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

function filterEventsForNode(events: readonly AgentEvent[], nodeId: string): readonly AgentEvent[] {
  if (nodeId === "planner") {
    return events.filter((event) => !("subagent" in event) || event.subagent === undefined);
  }
  return events.filter((event) => "subagent" in event && event.subagent === nodeId);
}

function isPlanNodeEvent(event: PlanJsonlEvent, nodeId: string): boolean {
  if (
    event.kind === "plan_agent_node_started" ||
    event.kind === "plan_agent_node_findings" ||
    event.kind === "plan_agent_node_usage" ||
    event.kind === "plan_agent_node_ended"
  ) {
    return event.nodeId === nodeId;
  }
  if (nodeId === "planner") return event.kind === "plan_system" || event.kind === "plan_usage";
  return false;
}

function describePlanEvent(event: PlanJsonlEvent, nodeTitle?: string): string {
  const label = nodeTitle ?? "node";
  switch (event.kind) {
    case "plan_system":
      return event.systemKind;
    case "plan_usage":
      return `usage ${formatCompact(event.cumulativeInputTokens)} in`;
    case "plan_agent_node_started":
      return `${event.title} started`;
    case "plan_agent_node_findings":
      return `${label} returned findings`;
    case "plan_agent_node_usage":
      return `${label} usage ${formatCompact(event.inputTokens)} in · $${event.costUsd.toFixed(4)}`;
    case "plan_agent_node_ended":
      return `${label} ${event.status}`;
    default:
      return event.kind;
  }
}

function latestFindingsForNode(
  events: readonly PlanJsonlEvent[],
  nodeId: string | null,
): Extract<PlanJsonlEvent, { kind: "plan_agent_node_findings" }> | null {
  if (nodeId === null) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "plan_agent_node_findings" && event.nodeId === nodeId) {
      return event;
    }
  }
  return null;
}

function artifactItem(name: string, artifact: Artifact | null): { name: string; artifact: Artifact } | null {
  return artifact ? { name, artifact } : null;
}

function OverviewSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
        {title}
      </div>
      {children}
    </section>
  );
}

function SummaryPill({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="inline-flex min-h-[29px] items-center gap-1.5 rounded-[7px] border border-line bg-white/[0.02] px-2.5 font-mono text-[11px] text-fg-mute">
      {label}
      <strong className="font-semibold text-fg-body">{value}</strong>
    </span>
  );
}

function MetricTile({
  label,
  value,
  compact = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly compact?: boolean;
}) {
  return (
    <div className={`rounded-[7px] border border-line bg-bg ${compact ? "p-2" : "px-2.5 py-2"}`}>
      <div className={`${compact ? "text-[13px]" : "text-[15px]"} truncate font-semibold text-fg`}>
        {value}
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-fg-mute">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-[7px] border border-line bg-bg p-2">
      <div className="text-[16px] font-semibold text-fg">{value}</div>
      <div className="font-mono text-[10px] text-fg-mute">{label}</div>
    </div>
  );
}

function info(label: string, value: string): { readonly label: string; readonly value: string } {
  return { label, value };
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 rounded-[7px] border border-line bg-bg px-2.5 py-2 font-mono text-[11.5px]">
      <span className="text-fg-mute">{label}</span>
      <span className="min-w-0 break-words text-fg-body">{value}</span>
    </div>
  );
}

function summarizeRawEvents(events: readonly AgentEvent[]): {
  readonly messages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
} {
  return events.reduce(
    (summary, event) => ({
      messages: summary.messages + (event.kind === "message_delta" ? 1 : 0),
      toolCalls: summary.toolCalls + (event.kind === "tool_call" ? 1 : 0),
      toolResults: summary.toolResults + (event.kind === "tool_result" ? 1 : 0),
    }),
    { messages: 0, toolCalls: 0, toolResults: 0 },
  );
}

function StatusDot({ status }: { readonly status: PlanAgentGraphNode["status"] }) {
  const cls =
    status === "running"
      ? "bg-st-progress"
      : status === "succeeded" || status === "artifact"
        ? "bg-st-done"
        : status === "failed" || status === "blocked" || status === "cancelled"
          ? "bg-st-blocked"
          : "bg-fg-faint";
  return <span className={`h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function NodeIcon({ kind }: { readonly kind: PlanAgentGraphNode["kind"] }) {
  const common = "h-4 w-4 text-fg-mute";
  if (kind === "artifact") return <FileText className={common} />;
  if (kind === "planner") return <GitBranch className={common} />;
  if (kind === "synthesis") return <RefreshCw className={common} />;
  return <Activity className={common} />;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return value.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatDateTime(value: string | null): string {
  if (value === null) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function joinOrDash(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function useNowMs(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [enabled]);
  return nowMs;
}

function runningDurationMs(node: PlanAgentGraphNode, nowMs: number): number {
  if (node.startedAt === null) return node.durationMs;
  const startedAt = Date.parse(node.startedAt);
  if (!Number.isFinite(startedAt)) return node.durationMs;
  return Math.max(node.durationMs, nowMs - startedAt);
}

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function logToneClass(tone: LogRow["tone"]): string {
  if (tone === "progress") return "text-st-progress";
  if (tone === "done") return "text-st-done";
  if (tone === "blocked") return "text-st-blocked";
  return "text-fg-mute";
}

function serializeEvent(event: AgentEvent): Record<string, unknown> {
  return {
    ...event,
    ts: event.ts instanceof Date ? event.ts.toISOString() : event.ts,
  };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Request failed";
}
