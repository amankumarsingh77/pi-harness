"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
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
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FileText,
  GitBranch,
  Pause,
  Play,
  RefreshCw,
  X,
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
import { ArtifactMarkdown, slugFromChildren } from "@/components/artifact-markdown";
import { CodeBlock } from "@/components/code-block";
import { formatRelativeCompact } from "@/lib/format";
import { ExecutionPhasesPreview } from "./execution-phases-preview";
import { buildLogRows, type LogRow } from "./plan-log-rows";
import { RestartPlanButton } from "./restart-plan-button";

type PlanCanvasNodeData = Record<string, unknown> & {
  readonly graphNode: PlanAgentGraphNode;
};
type PlanCanvasFlowNode = FlowNode<PlanCanvasNodeData, "plan-node">;
type ArtifactBundle = {
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly blastRadius: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly executionDag: Artifact | null;
};
type AgentTab = "overview" | "findings" | "logs" | "prompt";
type ArtifactTab = "plan.md" | "phase plans" | "execution-dag.yaml" | "scenarios.yaml" | "blast-radius.yaml" | "Raw";

const planEdgeStroke = "rgba(94,106,210,0.82)";
const agentTabs: readonly AgentTab[] = ["overview", "findings", "logs", "prompt"];

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
  const [openAgentNodeId, setOpenAgentNodeId] = useState<string | null>(null);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const selectedNode =
    agentGraph.nodes.find((node) => node.id === selectedNodeId) ??
    agentGraph.nodes[0] ??
    null;
  const openAgentNode =
    openAgentNodeId !== null
      ? agentGraph.nodes.find((node) => node.id === openAgentNodeId) ?? null
      : null;
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
  const artifacts = { plan, phasePlans, blastRadius, scenarios, executionDag };

  function openNode(nodeId: string): void {
    setSelectedNodeId(nodeId);
    setOpenAgentNodeId(nodeId);
  }

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
            <button
              type="button"
              onClick={() => setArtifactsOpen(true)}
              className="inline-flex min-h-[29px] items-center gap-1.5 rounded-[7px] border border-line bg-white/[0.035] px-2.5 font-mono text-[11px] text-fg-body transition hover:border-line-hover hover:bg-card-hover"
            >
              <FileText size={13} className="text-st-review" />
              Artifacts {artifactCount}
            </button>
            {canCancelRun && (
              <CancelPhaseRunButton taskId={task.id} phase="plan" disabled={false} />
            )}
            <RestartPlanButton taskId={task.id} disabled={!canRestart} />
            <PlanApprovalActions taskId={task.id} gate={gate} taskStatus={task.status} />
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-card/70 p-3">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <MiniStat label="agents" value={agentCount} />
            <MiniStat label="running" value={runningCount} />
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
                  onClick={() => openNode(node.id)}
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
            onNodeClick={(_, node) => openNode(node.id)}
            className="bg-bg"
          >
            <Background color="rgba(255,255,255,0.08)" gap={28} size={1} />
            <Controls className="!border-line !bg-card !shadow-none [&_button]:!border-line [&_button]:!bg-card [&_button]:!text-fg-body" />
          </ReactFlow>
        </section>
      </div>

      {openAgentNode && (
        <AgentDetailModal
          node={openAgentNode}
          planEvents={planEvents}
          liveEvents={liveEvents}
          onClose={() => setOpenAgentNodeId(null)}
        />
      )}
      {artifactsOpen && (
        <PlanArtifactsModal
          artifacts={artifacts}
          onClose={() => setArtifactsOpen(false)}
        />
      )}
    </main>
  );
}

function PlanCanvasNode({ data }: NodeProps<PlanCanvasFlowNode>) {
  const node = data.graphNode;
  return (
    <div className={`plan-agent-node ${planNodeStatusClass(node.status)} min-w-[210px] max-w-[260px] rounded-[8px] border border-line bg-card px-3 py-2.5 shadow-2xl shadow-black/25`}>
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

function AgentDetailModal({
  node,
  planEvents,
  liveEvents,
  onClose,
}: {
  readonly node: PlanAgentGraphNode;
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<AgentTab>("overview");
  const nodeEvents = useMemo(
    () => filterEventsForNode(liveEvents, node.id),
    [liveEvents, node.id],
  );
  const rows = useMemo(() => buildLogRows(nodeEvents), [nodeEvents]);

  return (
    <ModalShell ariaLabel="Agent dossier" onClose={onClose} size="agent">
      {(requestClose) => (
        <>
          <header className="border-b border-line bg-white/[0.015] px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-1">
                <StatusDot status={node.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">agent dossier</div>
                <h2 className="mt-1 truncate text-[22px] font-semibold tracking-[-0.01em] text-fg">
                  {node.title}
                </h2>
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10.5px]">
                  <MetaPill>{node.role}</MetaPill>
                  <MetaPill>{node.lane}</MetaPill>
                  <MetaPill>{node.status}</MetaPill>
                </div>
              </div>
              <IconCloseButton label="Close agent dossier" onClose={requestClose} />
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)]">
            <SideTabRail
              ariaLabel="Agent detail sections"
              items={agentTabs}
              active={tab}
              onChange={setTab}
            />
            <div className="scroll-hide min-h-0 overflow-y-auto px-5 py-4">
              {tab === "overview" && (
                <OverviewTab node={node} planEvents={planEvents} rawEvents={nodeEvents} />
              )}
              {tab === "findings" && <FindingsTab node={node} planEvents={planEvents} />}
              {tab === "logs" && (
                <LogsTab rows={rows} rawEvents={nodeEvents} />
              )}
              {tab === "prompt" && <PromptTab node={node} />}
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function PlanArtifactsModal({
  artifacts,
  onClose,
}: {
  readonly artifacts: ArtifactBundle;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<ArtifactTab>("plan.md");
  const generatedCount = countArtifacts(artifacts);
  const readyCount = readyArtifactCount(artifacts);
  const navItems = artifactNavItems(artifacts);
  const selectedItem = navItems.find((item) => item.tab === tab) ?? navItems[0];
  const selectedTab = selectedItem?.tab ?? "plan.md";

  return (
    <ModalShell ariaLabel="Planning artifacts" onClose={onClose} size="artifact">
      {(requestClose) => (
        <>
          <header className="border-b border-line bg-white/[0.015] px-5 py-4">
            <div className="flex items-start gap-3">
              <FileText size={18} className="mt-0.5 text-st-review" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
                  generated during planning
                </div>
                <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-fg">Planning artifacts</h2>
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10.5px]">
                  <MetaPill>{readyCount} ready</MetaPill>
                  <MetaPill>{generatedCount} generated</MetaPill>
                </div>
              </div>
              <IconCloseButton label="Close planning artifacts" onClose={requestClose} />
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
            <ArtifactNavigator items={navItems} active={selectedTab} onChange={setTab} />
            {selectedItem && (
              <ArtifactWorkspace
                key={selectedItem.tab}
                item={selectedItem}
                tab={selectedTab}
                artifacts={artifacts}
              />
            )}
          </div>
        </>
      )}
    </ModalShell>
  );
}

function ModalShell({
  ariaLabel,
  children,
  onClose,
  size,
}: {
  readonly ariaLabel: string;
  readonly children: (requestClose: () => void) => ReactNode;
  readonly onClose: () => void;
  readonly size: "agent" | "artifact";
}) {
  const width = size === "agent" ? "w-[min(920px,calc(100vw-28px))]" : "w-[min(1180px,calc(100vw-28px))]";
  const dialogRef = useRef<HTMLElement>(null);
  const [closing, setClosing] = useState(false);

  // Play the exit animation, then run the real close. animationEnd is the happy path;
  // a timeout backstops interrupted/no-animation cases (reduced motion, jsdom). R1.
  const requestClose = useCallback(() => {
    if (closing) return;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
  }, [closing, onClose]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onClose, 220);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  useFocusTrap(dialogRef, requestClose);

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center bg-black/65 p-3 backdrop-blur-xs ${
        closing ? "backdrop-exit" : "backdrop-enter"
      }`}
      onClick={requestClose}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`${width} flex max-h-[calc(100vh-28px)] min-h-[min(720px,calc(100vh-28px))] flex-col overflow-hidden rounded-[10px] border border-line-strong bg-card shadow-[0_24px_120px_rgba(0,0,0,0.58)] outline-none ${
          closing ? "modal-exit" : "modal-enter"
        }`}
        onClick={(event) => event.stopPropagation()}
        onAnimationEnd={() => {
          if (closing) onClose();
        }}
      >
        {children(requestClose)}
      </section>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function IconCloseButton({
  label,
  onClose,
}: {
  readonly label: string;
  readonly onClose: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClose}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-fg-mute transition hover:bg-card-hover hover:text-fg"
    >
      <X size={16} />
    </button>
  );
}

function SideTabRail<T extends string>({
  ariaLabel,
  items,
  active,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly items: readonly T[];
  readonly active: T;
  readonly onChange: (item: T) => void;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="scroll-hide border-b border-line bg-bg/55 p-3 lg:border-b-0 lg:border-r"
    >
      <div className="flex gap-1 overflow-x-auto lg:grid lg:overflow-visible" role="tablist">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active === item}
            onClick={() => onChange(item)}
            className={`shrink-0 rounded-[7px] border px-3 py-2 text-left text-[12px] capitalize transition-[background-color,border-color,box-shadow,color] duration-150 active:translate-y-px ${
              active === item
                ? "border-st-progress/50 bg-st-progress/10 text-fg shadow-[inset_2px_0_0_rgba(96,165,250,0.65)]"
                : "border-transparent text-fg-mute hover:border-line hover:bg-white/[0.03] hover:text-fg-body"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
    </nav>
  );
}

type ArtifactNavItem = {
  readonly tab: ArtifactTab;
  readonly filename: string;
  readonly detail: string;
  readonly status: string;
  readonly artifact: Artifact | null;
};

function ArtifactNavigator({
  items,
  active,
  onChange,
}: {
  readonly items: readonly ArtifactNavItem[];
  readonly active: ArtifactTab;
  readonly onChange: (item: ArtifactTab) => void;
}) {
  return (
    <nav
      aria-label="Artifact files"
      className="scroll-hide border-b border-line bg-bg/55 p-3 lg:border-b-0 lg:border-r"
    >
      <div className="mb-2 flex items-center justify-between px-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-mute">
        <span>files</span>
        <span>{items.length}</span>
      </div>
      <div className="flex gap-1 overflow-x-auto lg:grid lg:overflow-visible" role="tablist">
        {items.map((item) => (
          <button
            key={item.tab}
            type="button"
            role="tab"
            aria-selected={active === item.tab}
            onClick={() => onChange(item.tab)}
            className={`grid min-w-[190px] grid-cols-[18px_minmax(0,1fr)] gap-2 rounded-[8px] border px-2.5 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 active:translate-y-px lg:min-w-0 ${
              active === item.tab
                ? "border-st-review/55 bg-st-review/10 shadow-[inset_2px_0_0_rgba(245,197,66,0.75)]"
                : "border-transparent bg-transparent hover:border-line hover:bg-white/[0.03]"
            }`}
          >
            <FileText size={14} className={active === item.tab ? "mt-0.5 text-st-review" : "mt-0.5 text-fg-faint"} />
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-fg-body">
                {item.filename}
              </span>
              <span className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-fg-mute">
                <span className="truncate">{item.detail}</span>
                <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9.5px] text-fg-faint">
                  {item.status}
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// The right-hand document pane: a header strip (filename, status, updated-by, copy +
// raw toggle) above the rendered artifact body. State (raw view) resets per file via the
// `key` on the parent.
function ArtifactWorkspace({
  item,
  tab,
  artifacts,
}: {
  readonly item: ArtifactNavItem;
  readonly tab: ArtifactTab;
  readonly artifacts: ArtifactBundle;
}) {
  const [raw, setRaw] = useState(false);
  const body = item.artifact?.body.trim() ?? null;
  const isMarkdown = tab === "plan.md" || tab === "phase plans";

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-bg/45" aria-label="Selected artifact">
      <ArtifactDocumentHeader
        item={item}
        body={body}
        canToggleRaw={isMarkdown && body !== null}
        raw={raw}
        onToggleRaw={() => setRaw((value) => !value)}
      />
      <div className="scroll-hide min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7">
        {raw && body !== null ? (
          <div className="mx-auto max-w-[900px]">
            <CodeBlock code={body} lang="markdown" />
          </div>
        ) : (
          <ArtifactTabBody tab={tab} artifacts={artifacts} />
        )}
      </div>
    </section>
  );
}

function ArtifactDocumentHeader({
  item,
  body,
  canToggleRaw,
  raw,
  onToggleRaw,
}: {
  readonly item: ArtifactNavItem;
  readonly body: string | null;
  readonly canToggleRaw: boolean;
  readonly raw: boolean;
  readonly onToggleRaw: () => void;
}) {
  const updatedAt = item.artifact?.fm.last_updated ?? null;
  return (
    <div className="flex min-h-[54px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-card/70 px-4 py-2.5">
      <FileText size={15} className="shrink-0 text-st-review" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12.5px] font-semibold text-fg">{item.filename}</div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-fg-mute">
          <span className="truncate">{artifactUpdatedBy(item.artifact)}</span>
          {updatedAt && (
            <>
              <span className="text-fg-faint">·</span>
              <span className="shrink-0">{formatRelativeCompact(updatedAt)} ago</span>
            </>
          )}
        </div>
      </div>
      <span className="hidden shrink-0 rounded-full border border-line bg-bg/70 px-2 py-0.5 font-mono text-[10px] text-fg-mute sm:inline-flex">
        {item.status}
      </span>
      {canToggleRaw && (
        <button
          type="button"
          onClick={onToggleRaw}
          aria-pressed={raw}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-line px-2 font-mono text-[10.5px] text-fg-body transition-colors hover:border-line-hover hover:bg-card-hover"
        >
          <Code2 size={12} className={raw ? "text-st-progress" : "text-fg-mute"} />
          {raw ? "Rendered" : "Raw"}
        </button>
      )}
      {body !== null && <CopyBodyButton value={body} />}
    </div>
  );
}

function CopyBodyButton({ value }: { readonly value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  function copy(): void {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1200);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied document" : "Copy document"}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border border-line px-2 font-mono text-[10.5px] text-fg-body transition-colors hover:border-line-hover hover:bg-card-hover"
    >
      {copied ? <Check size={12} className="text-st-done" /> : <Copy size={12} className="text-fg-mute" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MetaPill({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-bg/70 px-2 py-0.5 text-fg-mute">
      {children}
    </span>
  );
}

function FindingsTab({
  node,
  planEvents,
}: {
  readonly node: PlanAgentGraphNode;
  readonly planEvents: readonly PlanJsonlEvent[];
}) {
  const findings = latestFindingsForNode(planEvents, node.id);
  return (
    <div className="grid gap-3">
      {findings ? (
        <section key={findings.ts} className="flash-once rounded-[8px] border border-line bg-bg p-4">
          <div className="mb-3 font-mono text-[11.5px] text-fg-mute">returned findings</div>
          <div className="scroll-hide max-h-[600px] overflow-auto">
            <ArtifactMarkdown>{findings.body}</ArtifactMarkdown>
          </div>
        </section>
      ) : (
        <EmptyPanel title="No findings returned yet" />
      )}
      {node.artifactPath !== null && (
        <section className="rounded-[8px] border border-line bg-bg p-3 font-mono text-[11.5px] text-fg-body">
          <div className="text-fg-mute">node artifact path</div>
          <div className="mt-1 break-words">{node.artifactPath}</div>
        </section>
      )}
    </div>
  );
}

function PromptTab({ node }: { readonly node: PlanAgentGraphNode }) {
  if (node.prompt === null) return <EmptyPanel title="No prompt captured" />;
  return <PromptPreview prompt={node.prompt} />;
}

function ArtifactTabBody({
  tab,
  artifacts,
}: {
  readonly tab: ArtifactTab;
  readonly artifacts: ArtifactBundle;
}) {
  if (tab === "plan.md") return <MarkdownArtifact filename="plan.md" artifact={artifacts.plan} />;
  if (tab === "phase plans") return <PhasePlansArtifact phasePlans={artifacts.phasePlans} />;
  if (tab === "execution-dag.yaml") return <ExecutionDagArtifact artifact={artifacts.executionDag} />;
  if (tab === "scenarios.yaml") return <YamlArtifact filename="scenarios.yaml" artifact={artifacts.scenarios} />;
  if (tab === "blast-radius.yaml") return <YamlArtifact filename="blast-radius.yaml" artifact={artifacts.blastRadius} />;
  return <RawArtifactsView artifacts={artifacts} />;
}

function MarkdownArtifact({
  filename,
  artifact,
}: {
  readonly filename: string;
  readonly artifact: Artifact | null;
}) {
  if (artifact === null) return <MissingArtifact filename={filename} />;
  return <MarkdownDocument body={artifact.body} />;
}

// Rendered markdown with an optional right-hand section index. The TOC only appears for
// documents with enough headings and on wide viewports, so short artifacts stay clean.
function MarkdownDocument({ body }: { readonly body: string }) {
  const sections = useMemo(() => extractSections(body), [body]);
  const showToc = sections.length >= 4;
  return (
    <div className={`mx-auto grid w-full gap-8 ${showToc ? "max-w-[1040px] xl:grid-cols-[minmax(0,1fr)_184px]" : "max-w-[860px]"}`}>
      <article className="min-w-0">
        <ArtifactMarkdown>{body}</ArtifactMarkdown>
      </article>
      {showToc && <SectionToc sections={sections} />}
    </div>
  );
}

function SectionToc({ sections }: { readonly sections: readonly DocSection[] }) {
  return (
    <nav aria-label="Document sections" className="hidden self-start xl:block xl:sticky xl:top-0">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-mute">on this page</div>
      <ul className="grid gap-0.5 border-l border-line">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              onClick={(event) => scrollToSection(event, section.id)}
              className={`-ml-px block border-l border-transparent py-1 text-[11.5px] text-fg-mute transition-colors hover:border-line-hover hover:text-fg-body ${
                section.depth === 3 ? "pl-5" : "pl-3"
              }`}
            >
              {section.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function scrollToSection(event: React.MouseEvent<HTMLAnchorElement>, id: string): void {
  const target = document.getElementById(id);
  if (target === null) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

function PhasePlansArtifact({ phasePlans }: { readonly phasePlans: readonly Artifact[] }) {
  const [activePhase, setActivePhase] = useState(phasePlans[0]?.fm.phase ?? null);
  const activeArtifact =
    phasePlans.find((artifact) => artifact.fm.phase === activePhase) ??
    phasePlans[0] ??
    null;

  if (activeArtifact === null) return <MissingArtifact filename="phase plans" />;

  return (
    <div className="grid min-h-0 gap-4">
      <div
        role="tablist"
        aria-label="Phase plans"
        className="scroll-hide -mx-1 flex items-center gap-1.5 overflow-x-auto px-1"
      >
        {phasePlans.map((artifact) => {
          const phase = artifact.fm.phase ?? null;
          const label = `Phase ${phase ?? "?"}`;
          const selected = activeArtifact === artifact;
          return (
            <button
              key={`${label}:${artifact.fm.last_updated}`}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActivePhase(phase)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-[7px] border px-3 py-1.5 text-[12px] transition-[background-color,border-color,color] duration-150 active:translate-y-px ${
                selected
                  ? "border-st-review/50 bg-st-review/10 text-fg"
                  : "border-line text-fg-mute hover:border-line-hover hover:bg-white/[0.03] hover:text-fg-body"
              }`}
            >
              <span className="font-medium">{label}</span>
              <span className="font-mono text-[10px] text-fg-faint">{artifact.fm.status}</span>
            </button>
          );
        })}
      </div>
      <div className="min-w-0">
        <MarkdownDocument body={activeArtifact.body} />
      </div>
    </div>
  );
}

type DocSection = { readonly id: string; readonly text: string; readonly depth: 2 | 3 };

// Pull ## / ### headings out of markdown for the section index. Skips fenced code so a
// commented "## " inside a block isn't treated as a heading.
function extractSections(body: string): readonly DocSection[] {
  const lines = body.split("\n");
  const sections: DocSection[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.*\S)\s*$/.exec(line);
    if (match === null) continue;
    const text = match[2] ?? "";
    sections.push({ id: slugFromChildren(text), text, depth: match[1]?.length === 3 ? 3 : 2 });
  }
  return sections;
}

function ExecutionDagArtifact({ artifact }: { readonly artifact: Artifact | null }) {
  if (artifact === null) return <MissingArtifact filename="execution-dag.yaml" />;
  return (
    <div className="w-full">
      <ExecutionPhasesPreview artifact={artifact} />
    </div>
  );
}

function YamlArtifact({
  filename,
  artifact,
}: {
  readonly filename: string;
  readonly artifact: Artifact | null;
}) {
  if (artifact === null) return <MissingArtifact filename={filename} />;
  return (
    <div className="mx-auto max-w-[980px]">
      <CodeBlock code={artifact.body.trim()} lang="yaml" />
    </div>
  );
}

function RawArtifactsView({ artifacts }: { readonly artifacts: ArtifactBundle }) {
  const items = rawArtifactItems(artifacts);
  return (
    <div className="mx-auto grid max-w-[980px] gap-4">
      {items.map((item) =>
        item.artifact === null ? (
          <MissingFileRow key={item.filename} filename={item.filename} />
        ) : (
          <CodeBlock
            key={item.filename}
            code={item.artifact.body.trim()}
            lang={langForFilename(item.filename)}
          />
        ),
      )}
    </div>
  );
}

function MissingFileRow({ filename }: { readonly filename: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-line bg-card/30 px-3.5 py-3">
      <FileText size={13} className="text-fg-faint" />
      <span className="font-mono text-[11.5px] text-fg-mute">{filename}</span>
      <span className="ml-auto font-mono text-[10.5px] text-fg-faint">not generated</span>
    </div>
  );
}

function langForFilename(filename: string): string {
  if (filename.endsWith(".yaml") || filename.endsWith(".yml")) return "yaml";
  if (filename.endsWith(".md")) return "markdown";
  if (filename.endsWith(".json")) return "json";
  return "text";
}

function MissingArtifact({ filename }: { readonly filename: string }) {
  return (
    <div className="grid min-h-[360px] place-items-center rounded-[10px] border border-dashed border-line bg-card/40 px-6 py-10 text-center">
      <div>
        <FileText size={22} className="mx-auto mb-3 text-fg-faint" />
        <div className="text-[15px] font-semibold text-fg">{filename} has not been generated yet</div>
        <p className="mx-auto mt-2 max-w-[420px] font-mono text-[11.5px] leading-5 text-fg-mute">
          The planner is still running, or this artifact was not written for the current plan run.
        </p>
      </div>
    </div>
  );
}

function EmptyPanel({ title }: { readonly title: string }) {
  return (
    <p className="m-0 rounded-[8px] border border-dashed border-line bg-bg px-3 py-3 font-mono text-[11.5px] text-fg-mute">
      {title}
    </p>
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
    <div className="grid gap-4">
      <section aria-label="Agent summary" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MetricTile label={isRunning ? "runtime so far" : "runtime"} value={formatDuration(runtimeMs)} live={isRunning} />
        <MetricTile label={isRunning ? "cost so far" : "cost"} value={`$${node.costUsd.toFixed(4)}`} live={isRunning} />
        <MetricTile label={isRunning ? "tokens in so far" : "tokens in"} value={node.inputTokens.toLocaleString()} live={isRunning} />
        <MetricTile label={isRunning ? "tokens out so far" : "tokens out"} value={node.outputTokens.toLocaleString()} live={isRunning} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-4">
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
        </div>

        <div className="grid content-start gap-4">
          <OverviewSection title="activity">
            <div className="grid grid-cols-3 gap-2 border-t border-line/70 p-3">
              <MetricTile label="messages" value={activity.messages.toLocaleString()} compact />
              <MetricTile label="tool calls" value={activity.toolCalls.toLocaleString()} compact />
              <MetricTile label="results" value={activity.toolResults.toLocaleString()} compact />
            </div>
            <InfoRow label="latest" value={latestLifecycle ? describePlanEvent(latestLifecycle, node.title) : "-"} />
          </OverviewSection>

          <OverviewSection title="tools">
            <div className="border-t border-line/70 p-3">
              {node.tools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {node.tools.map((tool) => (
                    <span key={tool} className="rounded-[5px] border border-line bg-bg px-2 py-1 font-mono text-[10.5px] text-fg-body">
                      {tool}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="m-0 font-mono text-[11.5px] text-fg-mute">no tools registered</p>
              )}
            </div>
          </OverviewSection>

          {node.error && (
            <div className="rounded-[8px] border border-st-blocked/40 bg-st-blocked/[0.07] p-3 font-mono text-[11.5px] leading-5 text-st-blocked">
              {node.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LogsTab({
  rows,
  rawEvents,
}: {
  readonly rows: readonly LogRow[];
  readonly rawEvents: readonly AgentEvent[];
}) {
  return (
    <div className="grid gap-3">
      <section>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-mute">
          live tool calls
        </div>
        <ExpandableLogRows rows={rows} rawEvents={rawEvents} />
      </section>
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
  const isFreshRow = useSeenIds(visibleRows.map((row) => row.id));

  if (visibleRows.length === 0) {
    return <p className="font-mono text-[11.5px] text-fg-mute">no tool calls yet</p>;
  }

  return (
    <div className="grid gap-1.5 font-mono text-[11.5px]">
      {visibleRows.map((row) => {
        const expanded = openRow === row.id;
        return (
          <div
            key={row.id}
            className={`rounded-[6px] border border-line bg-bg ${isFreshRow(row.id) ? "flash-once" : ""}`}
          >
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
  const trimmedLength = comment.trim().length;
  const remaining = Math.max(0, MIN_REVISION_COMMENT - trimmedLength);
  const canSend = remaining === 0 && !pending;

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
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSend) {
              event.preventDefault();
              requestChanges();
            }
          }}
          disabled={pending}
          placeholder="What should change?"
          autoFocus
        />
        {error && <span className="font-mono text-[11px] text-st-blocked">{error}</span>}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto font-mono text-[10.5px] text-fg-mute">
            {remaining > 0 ? `${remaining} more char${remaining === 1 ? "" : "s"} to send` : "⌘↵ to send"}
          </span>
          <button type="button" className="rounded border border-line px-2.5 py-1.5 text-[12px] text-fg-body" onClick={() => setShowComment(false)} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded bg-st-blocked px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
            onClick={requestChanges}
            disabled={!canSend}
            title={remaining > 0 ? `${MIN_REVISION_COMMENT} character minimum` : undefined}
          >
            {pending && <RefreshCw size={12} className="animate-spin" />}
            {pending ? "Sending…" : "Send revision"}
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
        {pending ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
        {pending ? "Approving…" : "Approve"}
      </button>
    </div>
  );
}

const MIN_REVISION_COMMENT = 10;

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
    animated: false,
    style: {
      stroke: planEdgeStroke,
      strokeWidth: 1.6,
    },
  }));

  return { nodes, edges };
}

function planNodeStatusClass(status: PlanAgentGraphNode["status"]): string {
  if (status === "running") return "plan-agent-node-running";
  if (status === "succeeded") return "plan-agent-node-done";
  return "";
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

// Tracks which ids have already been rendered. The initial batch is seeded without
// flashing (so opening a populated panel is calm); only ids that appear in a later
// render are reported "fresh", and each fires its flash exactly once. AD5.
// Ref mutation happens in an effect (not during render) to satisfy react-hooks/refs.
function useSeenIds(ids: readonly string[]): (id: string) => boolean {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const key = ids.join("|");

  useEffect(() => {
    const next = new Set<string>();
    for (const id of ids) {
      if (!seen.current.has(id)) {
        if (seeded.current) next.add(id);
        seen.current.add(id);
      }
    }
    seeded.current = true;
    setFresh(next);
    // ids is reconstructed each render; key collapses it to a stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (id: string) => fresh.has(id);
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Trap Tab focus inside the dialog and restore focus to the trigger on unmount.
// Scoped to the container node so it does not fight ReactFlow / browser shortcuts.
function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    const first = focusables()[0];
    (first ?? container).focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || active === container)) {
        event.preventDefault();
        lastItem?.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem?.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [containerRef, onClose]);
}

function countArtifacts(artifacts: ArtifactBundle): number {
  return rawArtifactItems(artifacts).filter((item) => item.artifact !== null).length;
}

function readyArtifactCount(artifacts: ArtifactBundle): number {
  return rawArtifactItems(artifacts).filter((item) => isArtifactReady(item.artifact)).length;
}

function rawArtifactItems(
  artifacts: ArtifactBundle,
): readonly { readonly filename: string; readonly artifact: Artifact | null }[] {
  return [
    { filename: "plan.md", artifact: artifacts.plan },
    ...artifacts.phasePlans.map((artifact) => ({
      filename: `plan-${artifact.fm.phase ?? "?"}.md`,
      artifact,
    })),
    { filename: "execution-dag.yaml", artifact: artifacts.executionDag },
    { filename: "scenarios.yaml", artifact: artifacts.scenarios },
    { filename: "blast-radius.yaml", artifact: artifacts.blastRadius },
  ];
}

function artifactNavItems(artifacts: ArtifactBundle): readonly ArtifactNavItem[] {
  const phaseCount = artifacts.phasePlans.length;
  const generatedCount = countArtifacts(artifacts);
  return [
    artifactNavItem({
      tab: "plan.md",
      filename: "plan.md",
      detail: "plan summary",
      artifact: artifacts.plan,
    }),
    {
      tab: "phase plans",
      filename: "phase plans",
      detail: phaseCount === 1 ? "1 phase document" : `${phaseCount} phase documents`,
      status: phaseCount > 0 ? "ready" : "missing",
      artifact: artifacts.phasePlans[0] ?? null,
    },
    artifactNavItem({
      tab: "execution-dag.yaml",
      filename: "execution-dag.yaml",
      detail: "phase graph",
      artifact: artifacts.executionDag,
    }),
    artifactNavItem({
      tab: "scenarios.yaml",
      filename: "scenarios.yaml",
      detail: "test scenarios",
      artifact: artifacts.scenarios,
    }),
    artifactNavItem({
      tab: "blast-radius.yaml",
      filename: "blast-radius.yaml",
      detail: "risk surface",
      artifact: artifacts.blastRadius,
    }),
    {
      tab: "Raw",
      filename: "Raw",
      detail: generatedCount === 1 ? "1 generated file" : `${generatedCount} generated files`,
      status: generatedCount > 0 ? "bundle" : "empty",
      artifact: null,
    },
  ];
}

function artifactNavItem({
  tab,
  filename,
  detail,
  artifact,
}: {
  readonly tab: ArtifactTab;
  readonly filename: string;
  readonly detail: string;
  readonly artifact: Artifact | null;
}): ArtifactNavItem {
  return {
    tab,
    filename,
    detail,
    status: artifact?.fm.status ?? "missing",
    artifact,
  };
}

function artifactUpdatedBy(artifact: Artifact | null): string {
  if (artifact === null) return "not generated for this run";
  return `updated by ${artifact.fm.last_updated_by}`;
}

function isArtifactReady(artifact: Artifact | null): boolean {
  return (
    artifact?.fm.status === "ready" ||
    artifact?.fm.status === "human_edited" ||
    artifact?.fm.status === "approved"
  );
}

function OverviewSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-line bg-card/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-mute">
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
  live = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly compact?: boolean;
  readonly live?: boolean;
}) {
  return (
    <div className={`rounded-[8px] border border-line bg-card/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] ${compact ? "p-2" : "px-3 py-2.5"}`}>
      <div className={`${compact ? "text-[13px]" : "text-[15px]"} truncate font-semibold text-fg`}>
        {value}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-fg-mute">
        {live && (
          <span
            aria-hidden="true"
            className="pulse-dot shrink-0 text-st-progress"
            style={{ width: 5, height: 5 }}
          />
        )}
        <span className="truncate">{label}</span>
      </div>
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
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-t border-line/70 px-3 py-2.5 font-mono text-[11.5px]">
      <span className="text-fg-mute">{label}</span>
      <span className="min-w-0 break-words text-fg-body">{value}</span>
    </div>
  );
}

function PromptPreview({ prompt }: { readonly prompt: string }) {
  return (
    <div className="rounded-[7px] border border-line bg-bg p-2.5">
      <div className="font-mono text-[11px] text-fg-mute">prompt sent</div>
      <pre className="scroll-hide mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-fg-body">
        {prompt}
      </pre>
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

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Request failed";
}
