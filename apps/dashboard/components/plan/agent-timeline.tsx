"use client";
import { useMemo } from "react";
import type { AgentEvent } from "@pi-harness/shared";

// Renders one tool-call row per (call, result) pair from a stream of events
// already filtered to a single subagent. Tool-calls only — message_delta /
// log are intentionally dropped per the plan spec (calmest, most scannable).
//
// Pairing logic mirrors agent-log.tsx#enrichEvents: a tool_call seeds a row;
// the next matching tool_result for the same tool refines the status.
// Orphan results (no preceding call) render as their own row.

type Row = {
  id: string;
  ts: Date;
  verb: string;
  arg: string;
  status: "pending" | "ok" | "fail";
};

export function AgentTimeline({
  events,
  emptyText = "no tool calls yet",
}: {
  events: AgentEvent[];
  emptyText?: string;
}) {
  const rows = useMemo(() => buildRows(events), [events]);

  if (rows.length === 0) {
    return (
      <p className="px-1 py-2 font-mono text-[11.5px] text-fg-mute">{emptyText}</p>
    );
  }

  return (
    <div className="font-mono text-[11.5px] leading-[1.7] text-fg-body">
      {rows.map((r) => (
        <div
          key={r.id}
          className="grid grid-cols-[64px_44px_1fr] items-baseline gap-2.5"
        >
          <span className="text-fg-faint">{formatTime(r.ts)}</span>
          <span
            className={
              r.status === "fail" ? "text-st-blocked" : "text-st-progress"
            }
          >
            {r.verb}
          </span>
          <span className="break-all">{r.arg}</span>
        </div>
      ))}
    </div>
  );
}

function buildRows(events: AgentEvent[]): Row[] {
  const rows: Row[] = [];
  const pending = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool_call") {
      const verb = normalizeToolName(e.tool);
      const arg = summarizeInput(e.tool, e.input);
      rows.push({
        id: e.id,
        ts: new Date(e.ts),
        verb,
        arg,
        status: "pending",
      });
      pending.set(callKey(e), rows.length - 1);
      continue;
    }
    if (e.kind === "tool_result") {
      const idx = pending.get(callKey(e));
      if (idx !== undefined) {
        rows[idx]!.status = e.ok ? "ok" : "fail";
        pending.delete(callKey(e));
      } else {
        rows.push({
          id: e.id,
          ts: new Date(e.ts),
          verb: normalizeToolName(e.tool),
          arg: "",
          status: e.ok ? "ok" : "fail",
        });
      }
    }
  }
  return rows;
}

function callKey(
  e: Extract<AgentEvent, { kind: "tool_call" | "tool_result" }>,
): string {
  return e.callId ?? `tool:${e.tool}`;
}

function normalizeToolName(tool: string): string {
  const t = tool.toLowerCase();
  if (t === "bash" || t === "shell") return "bash";
  if (t === "read" || t === "read_file") return "read";
  if (t === "write" || t === "write_file") return "write";
  if (t === "edit" || t === "str_replace") return "edit";
  if (t === "grep") return "grep";
  if (t === "glob") return "glob";
  return t;
}

function summarizeInput(tool: string, input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const t = tool.toLowerCase();
  if (t === "read" || t === "read_file") {
    return stringField(obj, ["file_path", "path", "filename"]) ?? "";
  }
  if (t === "write" || t === "write_file") {
    return stringField(obj, ["file_path", "path", "filename"]) ?? "";
  }
  if (t === "edit" || t === "str_replace") {
    return stringField(obj, ["file_path", "path", "filename"]) ?? "";
  }
  if (t === "grep") {
    const q = stringField(obj, ["pattern", "query"]);
    const where = stringField(obj, ["path", "include", "glob"]);
    return where ? `${q ?? ""}  ${where}` : q ?? "";
  }
  if (t === "glob") {
    return stringField(obj, ["pattern", "path"]) ?? "";
  }
  if (t === "bash" || t === "shell") {
    const cmd = stringField(obj, ["command", "cmd"]);
    return cmd ? truncate(cmd, 72) : "";
  }
  return "";
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
