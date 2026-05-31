"use client";

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
  readonly onExpand: () => void;
}) {
  const parsed = artifact ? groupNodesByPhase(parseExecutionDag(artifact.body).nodes) : [];
  const nodeCount = parsed.reduce((total, phase) => total + phase.nodes.length, 0);

  return (
    <article className="mb-3 overflow-hidden rounded-[9px] border border-line bg-card">
      <header className="flex items-center gap-2.5 border-b border-line px-3 py-3">
        <span className="font-mono text-[12px] font-semibold text-fg">execution phases</span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
          {nodeCount > 0 ? `${parsed.length} phases · ${nodeCount} tasks` : "not authored"}
        </span>
        <button
          type="button"
          className="min-h-[26px] rounded-[7px] border border-line bg-white/[0.02] px-2 font-mono text-[10.5px] text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/[0.045]"
          onClick={onExpand}
        >
          Raw
        </button>
      </header>

      {parsed.length === 0 ? (
        <p className="m-0 px-4 py-4 font-mono text-[12px] italic text-fg-mute">
          execution phases not authored yet
        </p>
      ) : (
        <div className="divide-y divide-line">
          {parsed.map((phase, index) => (
            <PhaseRow
              key={`${phase.name}-${index}`}
              phase={phase}
              showArrow={index < parsed.length - 1}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function PhaseRow({
  phase,
  showArrow,
}: {
  readonly phase: PhaseGroup;
  readonly showArrow: boolean;
}) {
  const exclusiveCount = phase.nodes.filter((node) => node.safety === "exclusive").length;
  const label = phase.policy === "parallel" ? "can run together" : "ordered";

  return (
    <section className="grid grid-cols-[34px_minmax(0,1fr)] gap-2 px-4 py-3">
      <div className="flex flex-col items-center pt-0.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line font-mono text-[10px] text-fg-body">
          {phase.nodes.length}
        </span>
        {showArrow && <span className="mt-2 h-8 w-px bg-line" aria-hidden="true" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-[13px] font-semibold leading-tight text-fg">
            {phase.name}
          </h3>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-mute">
            {label}
          </span>
          {exclusiveCount > 0 && (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-mute">
              {exclusiveCount} exclusive
            </span>
          )}
        </div>
        <div className="mt-2 grid gap-1.5 md:grid-cols-2">
          {phase.nodes.map((node) => (
            <NodeChip key={node.id} node={node} />
          ))}
        </div>
      </div>
    </section>
  );
}

function NodeChip({ node }: { readonly node: ParsedDagNode }) {
  return (
    <div className="min-w-0 rounded-[7px] border border-line bg-white/[0.015] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-fg-mute">{node.id}</span>
        <span className="truncate text-[12px] font-medium text-fg-body">{node.title}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-fg-mute">
        {node.lane} · {node.kind} · {node.safety === "exclusive" ? "exclusive" : "parallel-safe"}
        {node.dependsOn.length > 0 ? ` · waits for ${node.dependsOn.join(", ")}` : ""}
      </div>
    </div>
  );
}
