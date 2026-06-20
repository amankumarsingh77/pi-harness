"use client";

import { useMemo, useState } from "react";
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
import { X } from "lucide-react";
import type { Artifact } from "@pi-harness/shared";
import {
  parseExecutionDag,
  type ParsedDagNode,
} from "@/lib/code/parse-execution-dag";

// Execution DAG rendered as an interactive dependency graph: tasks are laid out in
// left-to-right phase columns, `dependsOn` relationships are drawn as edges, and
// selecting a node highlights its dependency chain and opens a floating inspector
// (overlaid on the canvas so it never steals layout width).

const EDGE_STROKE = "rgba(94,106,210,0.7)";
const EDGE_STROKE_DIM = "rgba(94,106,210,0.14)";
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 168;

type DagNodeData = Record<string, unknown> & {
  readonly node: ParsedDagNode;
  readonly dimmed: boolean;
  readonly selected: boolean;
};
type DagFlowNode = FlowNode<DagNodeData, "dag-task">;

const nodeTypes: NodeTypes = { "dag-task": DagTaskNode };

export function ExecutionPhasesPreview({
  artifact,
  onExpand,
}: {
  readonly artifact: Artifact | null;
  readonly onExpand?: () => void;
}) {
  const dag = useMemo(() => parseExecutionDag(artifact?.body ?? ""), [artifact]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodeCount = dag.nodes.length;
  const parallelCount = dag.nodes.filter((node) => node.safety === "parallel-safe").length;
  const exclusiveCount = dag.nodes.filter((node) => node.safety === "exclusive").length;
  const missingAssertions = dag.nodes.filter((node) => !node.assertion).length;

  const connected = useMemo(
    () => connectedSet(dag.nodes, selectedId),
    [dag.nodes, selectedId],
  );
  const layout = useMemo(
    () => buildGraph(dag.nodes, selectedId, connected),
    [dag.nodes, selectedId, connected],
  );
  const selected = dag.nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <article className="mb-3 overflow-hidden rounded-[9px] border border-line bg-card" aria-label="Execution map">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-3 py-3">
        <span className="text-[13px] font-semibold text-fg">Execution map</span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
          {nodeCount > 0 ? `${layout.layers.length} layers · ${nodeCount} tasks` : "not authored"}
        </span>
        {nodeCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <MetricPill value={`${parallelCount} parallel`} />
            <MetricPill value={`${exclusiveCount} exclusive`} />
            <MetricPill value={`${missingAssertions} missing assertions`} muted={missingAssertions === 0} />
          </div>
        )}
        {onExpand && (
          <button
            type="button"
            className="min-h-[26px] rounded-[7px] border border-line bg-white/[0.02] px-2 font-mono text-[10.5px] text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/[0.045]"
            onClick={onExpand}
          >
            Raw
          </button>
        )}
      </header>

      {nodeCount === 0 ? (
        <p className="m-0 px-4 py-4 font-mono text-[12px] italic text-fg-mute">
          execution phases not authored yet
        </p>
      ) : (
        <div className="relative h-[clamp(420px,62vh,720px)] w-full">
          <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.3}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            className="bg-transparent"
          >
            <Background color="rgba(255,255,255,0.05)" gap={26} size={1} />
            <Controls
              showInteractive={false}
              className="!border-line !bg-card !shadow-none [&_button]:!border-line [&_button]:!bg-card [&_button]:!text-fg-body"
            />
          </ReactFlow>
          {selected && (
            <NodeInspector node={selected} onClose={() => setSelectedId(null)} />
          )}
        </div>
      )}
    </article>
  );
}

function DagTaskNode({ data }: NodeProps<DagFlowNode>) {
  const { node, dimmed, selected } = data;
  const parallel = node.safety === "parallel-safe";
  return (
    <div
      className={`w-[236px] rounded-[8px] border bg-card px-3 py-2.5 shadow-lg shadow-black/25 transition-opacity ${
        selected
          ? "border-st-progress shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_14px_36px_rgba(0,0,0,0.3)]"
          : "border-line"
      } ${dimmed ? "opacity-35" : "opacity-100"}`}
    >
      <Handle type="target" position={Position.Top} className="!border-line !bg-fg-faint" />
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-fg-mute">{node.id}</span>
        <span
          className={`ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[9px] ${
            parallel ? "bg-st-done/12 text-st-done" : "bg-white/[0.04] text-fg-mute"
          }`}
        >
          {parallel ? "parallel" : "exclusive"}
        </span>
      </div>
      <div className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug text-fg-body">
        {node.title}
      </div>
      <div className="mt-1.5 truncate font-mono text-[10px] text-fg-faint">
        {node.lane} · {node.kind}
      </div>
      <Handle type="source" position={Position.Bottom} className="!border-line !bg-fg-faint" />
    </div>
  );
}

function NodeInspector({
  node,
  onClose,
}: {
  readonly node: ParsedDagNode;
  readonly onClose: () => void;
}) {
  return (
    <aside
      key={node.id}
      className="flash-once absolute right-3 top-3 z-20 w-[300px] max-w-[calc(100%-24px)] rounded-[9px] border border-line-strong bg-card/95 p-3.5 shadow-[0_18px_60px_rgba(0,0,0,0.5)] backdrop-blur-sm"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 font-mono text-[10.5px] text-fg-mute">{node.id}</span>
        <h3 className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-fg">{node.title}</h3>
        <button
          type="button"
          aria-label="Close task inspector"
          onClick={onClose}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-fg-mute transition hover:bg-card-hover hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      <div className="mt-3 grid gap-2 font-mono text-[10.5px] text-fg-mute">
        <InspectorRow label="lane" value={node.lane} />
        <InspectorRow label="kind" value={node.kind} />
        <InspectorRow label="safety" value={node.safety} />
        <InspectorRow
          label="depends"
          value={node.dependsOn.length > 0 ? `waits for ${node.dependsOn.join(", ")}` : "ready immediately"}
        />
      </div>
      {node.assertion && (
        <p className="m-0 mt-3 rounded-[7px] border border-line bg-bg px-3 py-2 text-[12px] leading-5 text-fg-body">
          {node.assertion}
        </p>
      )}
    </aside>
  );
}

function InspectorRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
      <span className="text-fg-faint">{label}</span>
      <span className="min-w-0 break-words text-fg-body">{value}</span>
    </div>
  );
}

function MetricPill({ value, muted = false }: { readonly value: string; readonly muted?: boolean }) {
  return (
    <span
      className={[
        "rounded-full border px-2 py-0.5 font-mono text-[10px]",
        muted ? "border-line text-fg-mute" : "border-line-hover text-fg-body",
      ].join(" ")}
    >
      {value}
    </span>
  );
}

// The set of node ids in the selected node's dependency neighbourhood (the node, its
// ancestors and descendants). Empty when nothing is selected → nothing is dimmed.
function connectedSet(
  nodes: readonly ParsedDagNode[],
  selectedId: string | null,
): ReadonlySet<string> {
  if (selectedId === null) return new Set();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), node.id]);
    }
  }
  const result = new Set<string>([selectedId]);
  const walk = (id: string, next: (node: ParsedDagNode) => readonly string[]): void => {
    for (const neighbour of next(byId.get(id) ?? newEmpty(id))) {
      if (!result.has(neighbour)) {
        result.add(neighbour);
        walk(neighbour, next);
      }
    }
  };
  walk(selectedId, (node) => node.dependsOn);
  walk(selectedId, (node) => dependents.get(node.id) ?? []);
  return result;
}

function newEmpty(id: string): ParsedDagNode {
  return { id, title: id, phase: "", kind: "", lane: "", safety: "exclusive", dependsOn: [], assertion: null };
}

// Build the layers exactly the way the orchestrator schedules the DAG, so a row always
// means "these tasks actually run together in one tick". Mirrors
// apps/orchestrator/src/agents/code.ts: each tick takes the runnable nodes (pending with
// all deps done); if any is `exclusive` it runs ALONE, otherwise every runnable
// parallel-safe node runs together. Replaying that tick-by-tick gives honest layers —
// exclusive tasks fall onto their own row, and a multi-node row is genuinely parallel.
function scheduleLayers(nodes: readonly ParsedDagNode[]): Layer[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const done = new Set<string>();
  const scheduled = new Set<string>();
  const layers: Layer[] = [];

  // Only depend on nodes that exist (a dangling dep never blocks). Cap iterations at the
  // node count as a cycle/stall backstop — the schema rejects cycles, but the parser is lax.
  const ready = (): ParsedDagNode[] =>
    nodes.filter(
      (node) =>
        !scheduled.has(node.id) &&
        node.dependsOn.every((dep) => !byId.has(dep) || done.has(dep)),
    );

  for (let guard = 0; guard <= nodes.length && scheduled.size < nodes.length; guard += 1) {
    const runnable = ready();
    if (runnable.length === 0) break;

    const firstExclusive = runnable.find((node) => node.safety === "exclusive");
    const batch = firstExclusive ? [firstExclusive] : runnable;

    layers.push({ nodes: batch });
    for (const node of batch) {
      scheduled.add(node.id);
      done.add(node.id);
    }
  }

  // Any nodes left unscheduled (e.g. trapped in a cycle the lax parser let through) are
  // appended as a final layer so they remain visible rather than silently dropped.
  const leftover = nodes.filter((node) => !scheduled.has(node.id));
  if (leftover.length > 0) {
    layers.push({ nodes: leftover });
  }
  return layers;
}

type Layer = { readonly nodes: readonly ParsedDagNode[] };
type DagLayout = {
  readonly nodes: DagFlowNode[];
  readonly edges: FlowEdge[];
  readonly layers: readonly Layer[];
};

function buildGraph(
  nodes: readonly ParsedDagNode[],
  selectedId: string | null,
  connected: ReadonlySet<string>,
): DagLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const layers = scheduleLayers(nodes);
  const widest = Math.max(1, ...layers.map((layer) => layer.nodes.length));
  const canvasWidth = widest * COLUMN_WIDTH;

  const positionById = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, row) => {
    const count = layer.nodes.length;
    // Centre each layer's row of tasks within the widest layer's span.
    const rowWidth = count * COLUMN_WIDTH;
    const startX = (canvasWidth - rowWidth) / 2;
    layer.nodes.forEach((node, col) => {
      positionById.set(node.id, { x: startX + col * COLUMN_WIDTH, y: row * ROW_HEIGHT });
    });
  });

  const flowNodes = nodes.map((node): DagFlowNode => {
    const position = positionById.get(node.id) ?? { x: 0, y: 0 };
    const dimmed = selectedId !== null && !connected.has(node.id);
    return {
      id: node.id,
      type: "dag-task",
      position,
      data: { node, dimmed, selected: node.id === selectedId },
    };
  });

  const edges = nodes.flatMap((node) =>
    node.dependsOn
      .filter((source) => byId.has(source))
      .map((source): FlowEdge => {
        const active = selectedId === null || (connected.has(source) && connected.has(node.id));
        return {
          id: `${source}->${node.id}`,
          source,
          target: node.id,
          type: "smoothstep",
          animated: false,
          style: { stroke: active ? EDGE_STROKE : EDGE_STROKE_DIM, strokeWidth: active ? 1.7 : 1 },
        };
      }),
  );

  return { nodes: flowNodes, edges, layers };
}
