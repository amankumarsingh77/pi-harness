"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import { ChatToolCall } from "@/components/chat/chat-tool-call";
import type { CodeNodeView, CodeTranscriptItem } from "@/lib/code/derive-code-state";

export function CodeNodeDetail({ node }: { readonly node: CodeNodeView | null }) {
  if (!node) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-bg">
        <p className="font-mono text-[12px] text-fg-faint">Select a node to view its activity</p>
      </section>
    );
  }

  const live = node.status === "running";
  return (
    <section className="flex min-h-0 flex-col bg-bg">
      <div className="flex-none border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-fg-mute">{node.id}</span>
          <h2 className="m-0 text-[14px] font-semibold text-fg">{node.title}</h2>
          <StatusBadge status={node.status} />
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-mute">
            {node.safety}
          </span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-fg-mute">
            {summaryLine(node)}
          </span>
        </div>
        {node.assertion && (
          <p className="mt-2.5 text-[12px] leading-[1.45] text-fg-body">
            <span className="mr-1.5 text-[10.5px] uppercase tracking-[0.04em] text-fg-faint">Goal</span>
            {node.assertion}
          </p>
        )}
      </div>

      <div className="flex h-[34px] flex-none items-center gap-2.5 border-b border-line bg-muted px-5">
        <span className="font-mono text-[11px] text-fg-mute">transcript</span>
        {live && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-st-progress">
            <span className="pulse-dot" />
            live
          </span>
        )}
        {node.sessionId && (
          <span className="ml-auto font-mono text-[10.5px] text-fg-faint">session {node.sessionId}</span>
        )}
      </div>

      <Transcript items={node.transcript} live={live} />

      <div className="flex h-10 flex-none items-center gap-4 border-t border-line px-5 font-mono text-[11px] text-fg-mute">
        <span>
          tool calls <b className="font-medium tabular-nums text-fg-body">{node.toolCallCount}</b>
        </span>
        <span>
          edits <b className="font-medium tabular-nums text-fg-body">{node.editCount}</b>
        </span>
        <span className="ml-auto inline-flex gap-4">
          <span>
            in <b className="font-medium tabular-nums text-fg-body">{formatTokens(node.inputTokens)}</b>
          </span>
          <span>
            out <b className="font-medium tabular-nums text-fg-body">{formatTokens(node.outputTokens)}</b>
          </span>
          <span>
            cost <b className="font-medium tabular-nums text-st-progress">${node.costUsd.toFixed(2)}</b>
          </span>
        </span>
      </div>
    </section>
  );
}

function Transcript({
  items,
  live,
}: {
  readonly items: readonly CodeTranscriptItem[];
  readonly live: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, live]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-[11px] text-fg-faint">
          {live ? "waiting for the agent…" : "no activity"}
        </p>
      </div>
    );
  }

  return (
    <div className="scroll-hide flex-1 space-y-1 overflow-y-auto px-5 py-3.5">
      {items.map((item, index) => (
        <TranscriptRow
          key={item.id}
          item={item}
          isLast={index === items.length - 1}
          live={live}
        />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function TranscriptRow({
  item,
  isLast,
  live,
}: {
  readonly item: CodeTranscriptItem;
  readonly isLast: boolean;
  readonly live: boolean;
}) {
  if (item.kind === "tool") {
    return (
      <ChatToolCall
        callId={item.callId}
        tool={item.tool}
        input={item.input}
        status={item.status}
        {...(item.output !== undefined ? { output: item.output } : {})}
        {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
      />
    );
  }
  if (item.kind === "commit") {
    return (
      <div className="flex items-center gap-2 py-0.5 font-mono text-[11.5px] text-fg-body">
        <span className="text-fg-faint">commit</span>
        <span className="text-st-done">{item.commitSha.slice(0, 7)}</span>
      </div>
    );
  }
  if (item.kind === "log") {
    return (
      <div className="py-0.5 font-mono text-[11px] text-fg-mute">
        <span className={clsx(item.level === "error" && "text-st-blocked")}>{item.level}</span> · {item.text}
      </div>
    );
  }
  return (
    <p className="py-0.5 text-[11.5px] leading-[1.55] text-fg-body">
      {item.text}
      {live && isLast && <span className="cursor" aria-hidden="true" />}
    </p>
  );
}

function StatusBadge({ status }: { readonly status: CodeNodeView["status"] }) {
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 font-mono text-[10px]",
        status === "running" && "border-st-progress/40 text-st-progress",
        status === "succeeded" && "border-st-done/40 text-st-done",
        status === "failed" && "border-st-blocked/40 text-st-blocked",
        (status === "pending" || status === "blocked") && "border-line text-fg-mute",
      )}
    >
      {status}
    </span>
  );
}

function summaryLine(node: CodeNodeView): string {
  if (node.status === "running") return "running";
  if (node.durationMs !== null) return `${(node.durationMs / 1000).toFixed(1)}s`;
  return node.status;
}

function formatTokens(total: number): string {
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
  return String(total);
}
