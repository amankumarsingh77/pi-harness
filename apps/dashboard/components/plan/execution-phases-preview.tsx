"use client";

import { useMemo, useState } from "react";
import type { Artifact } from "@pi-harness/shared";
import {
  parseExecutionDag,
  groupNodesByPhase,
  type ParsedDagNode,
  type PhaseGroup,
} from "@/lib/code/parse-execution-dag";

export function ExecutionPhasesPreview({
  artifact,
  onExpand,
}: {
  readonly artifact: Artifact | null;
  readonly onExpand?: () => void;
}) {
  const dag = useMemo(() => parseExecutionDag(artifact?.body ?? ""), [artifact]);
  const parsed = groupNodesByPhase(dag.nodes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodeCount = dag.nodes.length;
  const selected = dag.nodes.find((node) => node.id === selectedId) ?? null;
  const parallelCount = dag.nodes.filter((node) => node.safety === "parallel-safe").length;
  const exclusiveCount = dag.nodes.filter((node) => node.safety === "exclusive").length;
  const missingAssertions = dag.nodes.filter((node) => !node.assertion).length;

  return (
    <article className="mb-3 overflow-hidden rounded-[9px] border border-line bg-card" aria-label="Execution map">
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-3 py-3">
        <span className="text-[13px] font-semibold text-fg">Execution map</span>
        <span className="sr-only">execution phases</span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
          {nodeCount > 0 ? `${parsed.length} phases · ${nodeCount} tasks` : "not authored"}
        </span>
        {nodeCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <MetricPill value={`${nodeCount} tasks`} />
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

      {parsed.length === 0 ? (
        <p className="m-0 px-4 py-4 font-mono text-[12px] italic text-fg-mute">
          execution phases not authored yet
        </p>
      ) : (
        <div className="grid gap-0 border-line lg:grid-cols-[minmax(0,1fr)_310px]">
          <div className="scroll-hide overflow-x-auto border-b border-line lg:border-b-0 lg:border-r">
            <div className="grid min-w-[720px] auto-cols-fr grid-flow-col">
              {parsed.map((phase, index) => (
                <PhaseColumn
                  key={`${phase.name}-${index}`}
                  phase={phase}
                  index={index}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          </div>
          <NodeInspector node={selected} />
        </div>
      )}
    </article>
  );
}

function MetricPill({ value, muted = false }: { readonly value: string; readonly muted?: boolean }) {
  return (
    <span className={[
      "rounded-full border px-2 py-0.5 font-mono text-[10px]",
      muted ? "border-line text-fg-mute" : "border-line-hover text-fg-body",
    ].join(" ")}>
      {value}
    </span>
  );
}

function PhaseColumn({
  phase,
  index,
  selectedId,
  onSelect,
}: {
  readonly phase: PhaseGroup;
  readonly index: number;
  readonly selectedId: string | null;
  readonly onSelect: (nodeId: string) => void;
}) {
  const exclusiveCount = phase.nodes.filter((node) => node.safety === "exclusive").length;
  const label = phase.policy === "parallel" ? "can run together" : "ordered";

  return (
    <section className="min-w-[240px] border-r border-line px-3 py-3 last:border-r-0">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full border border-line bg-bg font-mono text-[10px] text-fg-body">
          {index + 1}
        </span>
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[13px] font-semibold leading-tight text-fg">{phase.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <MetricPill value={label} />
            {exclusiveCount > 0 && <MetricPill value={`${exclusiveCount} exclusive`} />}
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {phase.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            selected={node.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function NodeCard({
  node,
  selected,
  onSelect,
}: {
  readonly node: ParsedDagNode;
  readonly selected: boolean;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Inspect ${node.id}: ${node.title}`}
      className={[
        "min-w-0 rounded-[7px] border px-2.5 py-2 text-left transition",
        selected
          ? "border-line-strong bg-st-progress/[0.07]"
          : "border-line bg-white/[0.015] hover:border-line-hover hover:bg-white/[0.035]",
      ].join(" ")}
      onClick={() => onSelect(node.id)}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-fg-mute">{node.id}</span>
        <span className="truncate text-[12px] font-medium text-fg-body">{node.title}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-fg-mute">
        {node.lane} · {node.kind} · {node.safety === "exclusive" ? "exclusive" : "parallel-safe"}
      </div>
    </button>
  );
}

function NodeInspector({ node }: { readonly node: ParsedDagNode | null }) {
  if (!node) {
    return (
      <aside className="px-4 py-4">
        <p className="m-0 font-mono text-[11.5px] text-fg-mute">Select a task to inspect its execution contract.</p>
      </aside>
    );
  }

  return (
    <aside className="bg-bg/50 px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] text-fg-mute">{node.id}</span>
        <h3 className="m-0 min-w-0 truncate text-[13px] font-semibold text-fg">Selected task</h3>
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
        <p className="m-0 mt-3 rounded-[7px] border border-line bg-card px-3 py-2 text-[12px] leading-5 text-fg-body">
          {node.assertion}
        </p>
      )}
    </aside>
  );
}

function InspectorRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <span className="text-fg-faint">{label}</span>
      <span className="min-w-0 truncate text-fg-body">{value}</span>
    </div>
  );
}
