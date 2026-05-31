"use client";

import { useState } from "react";
import { clsx } from "clsx";

type ToolStatus = "running" | "ok" | "error";

type Props = {
  readonly callId: string;
  readonly tool: string;
  readonly input: unknown;
  readonly status: ToolStatus;
  readonly output?: unknown;
  readonly durationMs?: number;
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function inputSummary(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const val = obj["command"] ?? obj["path"] ?? obj["query"] ?? obj["url"];
    if (typeof val === "string") return val;
  }
  return JSON.stringify(input);
}

function outputString(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/**
 * Chat tool-call card. Shows tool name + args + status + optional timing.
 * Status colours: running = st-progress, ok = st-done, error = st-blocked.
 * Clicking expands output when available (REQ-021/022/023, EDGE-008).
 */
export function ChatToolCall({ callId, tool, input, status, output, durationMs }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = output !== undefined && output !== null;

  const statusLabel =
    status === "running" ? "running" :
    status === "ok" ? (typeof output === "string" && output.includes("lines") ? output : "done") :
    "error";

  return (
    <div
      data-testid="chat-tool-call"
      data-call-id={callId}
      className={clsx(
        "overflow-hidden rounded-[7px] border border-[var(--color-line)] bg-white/[0.012]",
        hasOutput && "cursor-pointer",
      )}
      onClick={() => hasOutput && setExpanded((v) => !v)}
      role={hasOutput ? "button" : undefined}
      aria-expanded={hasOutput ? expanded : undefined}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-[7px] text-[11.5px]">
        {/* tool icon */}
        <span className="flex-none text-[var(--color-fg-faint)]">
          {tool === "grep" || tool === "search" ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="5" cy="5" r="3.3" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7.6 7.6L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2.5 1.5h4l3 3v6h-7z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              <path d="M6.5 1.5v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            </svg>
          )}
        </span>

        {/* tool name */}
        <span className="font-mono font-medium text-[var(--color-fg)]">{tool}</span>

        {/* args */}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-fg-mute)]">
          {inputSummary(input)}
        </span>

        {/* timing */}
        {durationMs !== undefined && status !== "running" && (
          <span
            data-testid="tool-duration"
            className="flex-none font-mono text-[10.5px] text-[var(--color-fg-faint)]"
          >
            {formatMs(durationMs)}
          </span>
        )}

        {/* status badge */}
        <span
          data-testid="tool-status"
          className={clsx(
            "flex-none items-center rounded-[5px] px-[7px] py-0.5 font-mono text-[10.5px]",
            status === "running" && "flex gap-1.5 text-[var(--color-st-progress)]",
            status === "ok" && "text-[var(--color-st-done)]",
            status === "error" && "text-[var(--color-st-blocked)]",
          )}
        >
          {status === "running" && (
            <span className="pulse-dot" />
          )}
          {statusLabel}
        </span>
      </div>

      {/* expandable output */}
      {expanded && hasOutput && (
        <div className="max-h-[130px] overflow-auto border-t border-[var(--color-line)] bg-[var(--color-input)] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-[var(--color-fg-mute)] whitespace-pre-wrap break-words">
          {outputString(output)}
        </div>
      )}
    </div>
  );
}
