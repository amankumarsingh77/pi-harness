"use client";

import type { AgentEvent } from "@pi-harness/shared";

export type LogRowTone = "progress" | "done" | "blocked" | "muted";

export type LogRow = {
  readonly id: string;
  readonly ts: Date;
  readonly verb: string;
  readonly detail: string;
  readonly tone: LogRowTone;
};

export function buildLogRows(events: readonly AgentEvent[]): readonly LogRow[] {
  const rows: LogRow[] = [];
  let stream: MessageStream | null = null;

  const flushStream = (): void => {
    if (!stream) return;
    const detail = truncate(stream.text.replace(/\s+/g, " ").trim(), 96);
    if (detail.length > 0) {
      rows.push({
        id: `${stream.firstId}:${stream.lastId}`,
        ts: toEventDate(stream.firstTs),
        verb: "msg",
        detail,
        tone: "muted",
      });
    }
    stream = null;
  };

  for (const event of events) {
    switch (event.kind) {
      case "tool_call":
        flushStream();
        rows.push({
          id: event.id,
          ts: toEventDate(event.ts),
          verb: normalizeToolName(event.tool),
          detail: summarizeInput(event.tool, event.input),
          tone: "progress" satisfies LogRowTone,
        });
        break;
      case "tool_result":
        flushStream();
        rows.push({
          id: event.id,
          ts: toEventDate(event.ts),
          verb: event.ok ? "ok" : "fail",
          detail: summarizeOutput(event.output),
          tone: event.ok ? "done" : "blocked",
        });
        break;
      case "log":
        flushStream();
        rows.push({
          id: event.id,
          ts: toEventDate(event.ts),
          verb: event.level,
          detail: event.text,
          tone: event.level === "error" ? "blocked" : event.level === "warn" ? "muted" : "done",
        });
        break;
      case "message_delta":
        if (stream === null) {
          stream = {
            firstId: event.id,
            lastId: event.id,
            firstTs: event.ts,
            text: event.text,
          };
        } else {
          stream = {
            firstId: stream.firstId,
            lastId: event.id,
            firstTs: stream.firstTs,
            text: `${stream.text}${event.text}`,
          };
        }
        break;
      default:
        flushStream();
    }
  }
  flushStream();

  return rows;
}

type MessageStream = {
  readonly firstId: string;
  readonly lastId: string;
  readonly firstTs: Date | string;
  readonly text: string;
};

export function LogRows({
  rows,
  emptyText = "no tool calls yet",
  limit,
}: {
  readonly rows: readonly LogRow[];
  readonly emptyText?: string;
  readonly limit?: number;
}) {
  const visibleRows = limit === undefined ? rows : rows.slice(-limit);

  if (visibleRows.length === 0) {
    return (
      <p className="px-1 py-2 font-mono text-[11.5px] text-fg-mute">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="font-mono text-[11.5px] leading-[1.7] text-fg-body">
      {visibleRows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[64px_48px_minmax(0,1fr)] items-baseline gap-2.5"
        >
          <span className="text-fg-faint">{formatTime(row.ts)}</span>
          <span className={toneClass(row.tone)}>{row.verb}</span>
          <span className="truncate">{row.detail}</span>
        </div>
      ))}
    </div>
  );
}

export function RawJsonlRows({
  events,
  emptyText = "no raw events yet",
}: {
  readonly events: readonly AgentEvent[];
  readonly emptyText?: string;
}) {
  if (events.length === 0) {
    return (
      <p className="px-1 py-2 font-mono text-[11.5px] text-fg-mute">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((event) => (
        <pre
          key={event.id}
          className="overflow-x-auto rounded border border-line bg-bg p-2.5 font-mono text-[11px] leading-[1.55] text-fg-body"
        >
          {JSON.stringify(serializeEvent(event), null, 2)}
        </pre>
      ))}
    </div>
  );
}

function serializeEvent(event: AgentEvent): Record<string, unknown> {
  return {
    ...event,
    ts: toEventDate(event.ts).toISOString(),
  };
}

function toEventDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toneClass(tone: LogRowTone): string {
  switch (tone) {
    case "progress":
      return "text-st-progress";
    case "done":
      return "text-st-done";
    case "blocked":
      return "text-st-blocked";
    case "muted":
      return "text-fg-mute";
  }
}

function normalizeToolName(tool: string): string {
  const t = tool.toLowerCase();
  if (t === "bash" || t === "shell") return "bash";
  if (t === "read" || t === "read_file") return "read";
  if (t === "write" || t === "write_file") return "write";
  if (t === "edit" || t === "str_replace") return "edit";
  if (t === "grep") return "grep";
  if (t === "glob") return "glob";
  return truncate(t, 8);
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
    return where ? `${q ?? ""} ${where}` : q ?? "";
  }
  if (t === "glob") {
    return stringField(obj, ["pattern", "path"]) ?? "";
  }
  if (t === "bash" || t === "shell") {
    const cmd = stringField(obj, ["command", "cmd"]);
    return cmd ? truncate(cmd, 96) : "";
  }
  return "";
}

function summarizeOutput(output: unknown): string {
  if (typeof output === "string") return truncate(output.replace(/\s+/g, " "), 96);
  if (output === null || output === undefined) return "";
  if (typeof output === "object") return "result";
  return String(output);
}

function stringField(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
