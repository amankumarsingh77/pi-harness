"use client";

import { clsx } from "clsx";
import { CodeNodeStatusIcon } from "./code-node-status-icon";
import type { CodeMetrics, CodeNodeView, CodeWaveView } from "@/lib/code/derive-code-state";

const POLICY_LABEL: Record<CodeWaveView["policy"], string> = {
  parallel: "can run together",
  sequential: "ordered",
};

export function CodeWavesPane({
  waves,
  metrics,
  selectedNodeId,
  onSelect,
}: {
  readonly waves: readonly CodeWaveView[];
  readonly metrics: CodeMetrics;
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-bg">
      <div className="flex h-[38px] flex-none items-center gap-2 border-b border-line px-4">
        <span className="text-[12px] font-semibold text-fg">Waves</span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-mute">{countSummary(metrics)}</span>
      </div>

      <div className="scroll-hide flex-1 overflow-y-auto py-1.5 pb-4">
        {waves.length === 0 ? (
          <p className="px-4 py-4 font-mono text-[11.5px] italic text-fg-mute">
            execution DAG not authored yet
          </p>
        ) : (
          waves.map((wave, index) => (
            <WaveRow
              key={wave.id}
              wave={wave}
              index={index}
              showConnector={index < waves.length - 1}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function WaveRow({
  wave,
  index,
  showConnector,
  selectedNodeId,
  onSelect,
}: {
  readonly wave: CodeWaveView;
  readonly index: number;
  readonly showConnector: boolean;
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <section className="relative px-4 pb-1 pt-2.5">
      {showConnector && (
        <span
          aria-hidden="true"
          className="absolute bottom-[-6px] left-[25px] top-[33px] w-px bg-line"
        />
      )}
      <div className="mb-2.5 flex items-center gap-2">
        <WaveBadge state={wave.state} index={index} />
        <span className="text-[12.5px] font-semibold text-fg">{wave.name}</span>
        <span className="rounded-full border border-line px-[7px] py-px font-mono text-[9.5px] text-fg-mute">
          {POLICY_LABEL[wave.policy]}
        </span>
      </div>
      <div className="grid gap-1.5 pl-[26px]">
        {wave.nodes.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            selected={node.id === selectedNodeId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

function WaveBadge({ state, index }: { readonly state: CodeWaveView["state"]; readonly index: number }) {
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border font-mono text-[9.5px] tabular-nums",
        state === "done" && "border-st-done/50 text-st-done",
        state === "running" && "border-st-progress/60 text-st-progress",
        state === "pending" && "border-line-hover text-fg-body",
      )}
    >
      {state === "done" ? "✓" : index + 1}
    </span>
  );
}

function NodeRow({
  node,
  selected,
  onSelect,
}: {
  readonly node: CodeNodeView;
  readonly selected: boolean;
  readonly onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="code-node-row"
      data-node-id={node.id}
      aria-pressed={selected}
      onClick={() => onSelect(node.id)}
      className={clsx(
        "grid grid-cols-[16px_1fr] items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-line-strong bg-st-progress/[0.06]"
          : "border-line bg-white/[0.012] hover:border-line-hover hover:bg-white/[0.03]",
        (node.status === "pending" || node.status === "blocked") && "opacity-70",
      )}
    >
      <span className="mt-px">
        <CodeNodeStatusIcon status={node.status} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-fg-mute">{node.id}</span>
          <span className="truncate text-[12px] font-medium text-fg-body">{node.title}</span>
          <span className={clsx("ml-auto font-mono text-[10px] tabular-nums", statTone(node.status))}>
            {nodeStat(node)}
          </span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-fg-mute">
          {node.subLine}
        </span>
      </span>
    </button>
  );
}

function statTone(status: CodeNodeView["status"]): string {
  switch (status) {
    case "succeeded":
      return "text-st-done";
    case "running":
      return "text-st-progress";
    case "failed":
      return "text-st-blocked";
    default:
      return "text-fg-faint";
  }
}

function nodeStat(node: CodeNodeView): string {
  if (node.status === "running") return node.startedAt ? "running" : "";
  if (node.status === "succeeded" && node.durationMs !== null) return formatDuration(node.durationMs);
  return node.status;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${mins}:${String(rem).padStart(2, "0")}`;
}

function countSummary(metrics: CodeMetrics): string {
  const left = metrics.totalCount - metrics.doneCount;
  return `${metrics.doneCount} done · ${left} left`;
}
