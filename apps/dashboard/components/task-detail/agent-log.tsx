"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { AgentEvent } from "@pi-harness/shared";
import { useEvents } from "@/lib/use-events";

/**
 * Live agent log. Three-column grid: timestamp · phase · message. Phase is
 * derived from the most-recent `phase_started` event; phases color-code
 * (brainstorm/plan in mute, code in progress-blue, verify in review-yellow).
 *
 * Tool calls (bash / read / write / edit) render as one-line summaries with
 * their result status (✓ / ✗ / pending). Click any tool row to expand its
 * input + output for inspection.
 */

type Phase = "intake" | "brainstorm" | "plan" | "code" | "verify" | "pr";

const PHASE_COLOR: Record<Phase, string> = {
  intake:     "text-fg-mute-2",
  brainstorm: "text-fg-mute",
  plan:       "text-fg-mute",
  code:       "text-st-progress",
  verify:     "text-st-review",
  pr:         "text-st-shipping",
};

export function AgentLog({
  events,
  runId,
  live = false,
}: {
  events: AgentEvent[];
  runId: string;
  live?: boolean;
}) {
  const [autoscroll, setAutoscroll] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const subscribeId = live && runId !== "—" ? runId : null;
  const { events: liveEvents } = useEvents(subscribeId);

  const merged = useMemo(
    () => mergeById(events, liveEvents).filter((e) => e.kind !== "message_delta"),
    [events, liveEvents],
  );

  // Auto-scroll only when user hasn't scrolled away from the bottom. Avoids
  // yanking the viewport while they're reading older entries.
  useEffect(() => {
    if (!autoscroll) return;
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [merged.length, autoscroll]);

  const rows = enrichEvents(merged);
  const lastIdx = rows.length - 1;

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center gap-3 border-b border-line px-6 text-xs text-fg-mute">
        <span className="font-mono text-[11px] tracking-wide text-fg-mute-2">AGENT LOG</span>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-st-progress">
            <span className="pulse-dot" /> streaming
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 font-mono text-[11px] text-fg-mute-2">
          <Toggle on={autoscroll} onClick={() => setAutoscroll((v) => !v)}>autoscroll</Toggle>
          <Toggle on={wrap} onClick={() => setWrap((v) => !v)}>wrap</Toggle>
          <span>
            {runId.slice(0, 6)} · {merged.length} events
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="no-scrollbar flex-1 overflow-y-auto py-2 font-mono text-xs leading-relaxed"
      >
        {rows.map((row, i) => (
          <Row
            key={row.id}
            row={row}
            isLast={i === lastIdx}
            live={live}
            wrap={wrap}
            expanded={expanded.has(row.id)}
            onToggle={() => row.expandable && toggleExpand(row.id)}
          />
        ))}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function Row({
  row,
  isLast,
  live,
  wrap,
  expanded,
  onToggle,
}: {
  row: EnrichedRow;
  isLast: boolean;
  live: boolean;
  wrap: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLive = isLast && live;
  return (
    <div className="px-6">
      <div
        className={clsx(
          "grid grid-cols-[76px_86px_1fr] gap-3.5 py-px hover:bg-white/[0.02]",
          isLive && "text-fg",
          row.expandable && "cursor-pointer",
        )}
        onClick={onToggle}
        role={row.expandable ? "button" : undefined}
        aria-expanded={row.expandable ? expanded : undefined}
      >
        <span
          className={clsx(
            "text-fg-faint",
            isLive && "before:mr-1 before:text-st-progress before:content-['▸']",
          )}
        >
          {formatTime(row.ts)}
        </span>
        <span className={clsx("lowercase", PHASE_COLOR[row.phase])}>{row.phase}</span>
        <span className="flex min-w-0 items-center gap-2">
          {row.expandable && (
            <span
              className="inline-block w-2 shrink-0 text-fg-faint"
              aria-hidden
            >
              {expanded ? "▾" : "▸"}
            </span>
          )}
          <span
            className={clsx(
              "min-w-0 flex-1 text-fg-body",
              wrap ? "whitespace-pre-wrap break-words" : "truncate",
            )}
          >
            <Message text={row.message} />
          </span>
          {row.statusBadge && (
            <StatusBadge status={row.statusBadge} />
          )}
        </span>
      </div>
      {expanded && row.detail && (
        <div className="mt-1 mb-2 ml-[176px] rounded border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-fg-mute">
          <ExpandedDetail detail={row.detail} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "fail" | "pending" }) {
  if (status === "pending") {
    return <span className="text-fg-faint" aria-label="pending">…</span>;
  }
  if (status === "ok") {
    return <span className="text-st-done" aria-label="ok">✓</span>;
  }
  return <span className="text-st-blocked" aria-label="failed">✗</span>;
}

function ExpandedDetail({ detail }: { detail: ToolDetail }) {
  return (
    <div className="flex flex-col gap-2">
      {detail.input !== undefined && (
        <DetailBlock label="input" body={prettyJson(detail.input)} />
      )}
      {detail.bash && (
        <>
          <DetailBlock label="command" body={detail.bash.command} />
          {detail.bash.stdout && <DetailBlock label="stdout" body={detail.bash.stdout} />}
          {detail.bash.stderr && <DetailBlock label="stderr" body={detail.bash.stderr} />}
          {typeof detail.bash.exitCode === "number" && (
            <DetailBlock label="exit" body={String(detail.bash.exitCode)} />
          )}
        </>
      )}
      {detail.output !== undefined && !detail.bash && (
        <DetailBlock label="output" body={coerceToString(detail.output)} />
      )}
    </div>
  );
}

function DetailBlock({ label, body }: { label: string; body: string }) {
  const truncated = body.length > 4096;
  const display = truncated ? body.slice(0, 4096) + "\n… (truncated)" : body;
  return (
    <div>
      <div className="mb-1 text-[10px] tracking-wide text-fg-mute-2 uppercase">
        {label}
      </div>
      <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words text-fg-body">
        {display}
      </pre>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-fg-mute-2 transition-colors hover:text-fg-body"
    >
      <span
        className={clsx(
          "relative inline-block h-[11px] w-[11px] rounded-[2px] border border-line-strong",
          on && "border-st-progress bg-st-progress",
        )}
        style={
          on
            ? { background: "var(--color-st-progress)", borderColor: "var(--color-st-progress)" }
            : undefined
        }
      >
        {on && (
          <span
            className="absolute top-0 left-[2px] h-[7px] w-[4px] rotate-45 border-r-[1.5px] border-b-[1.5px] border-white"
            aria-hidden
          />
        )}
      </span>
      {children}
    </button>
  );
}

function Message({ text }: { text: string }) {
  const PATH_RE = /\b[\w./-]+\.(?:ts|tsx|md|json)\b/g;
  if (!PATH_RE.test(text)) return <>{text}</>;
  PATH_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} className="rounded-sm bg-white/[0.04] px-1 text-fg">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function formatTime(d: Date): string {
  return d.toISOString().slice(11, 19);
}

// ── enrichment ─────────────────────────────────────────────────────────────

type ToolDetail = {
  input?: unknown;
  output?: unknown;
  bash?: { command: string; stdout?: string; stderr?: string; exitCode?: number };
};

type EnrichedRow = {
  id: string;
  ts: Date;
  phase: Phase;
  message: string;
  expandable: boolean;
  statusBadge?: "ok" | "fail" | "pending";
  detail?: ToolDetail;
};

function mergeById(initial: AgentEvent[], live: AgentEvent[]): AgentEvent[] {
  if (live.length === 0) return initial;
  const seen = new Set<string>();
  const out: AgentEvent[] = [];
  for (const e of initial) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  for (const e of live) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

// Walks events in order, pairing each tool_call with its subsequent
// tool_result for the same tool. tool_result events are folded into the
// matching call rather than rendered as their own row — a row is the
// lifecycle of the call.
function enrichEvents(events: AgentEvent[]): EnrichedRow[] {
  let phase: Phase = "intake";
  const rows: EnrichedRow[] = [];
  const callRowIdx = new Map<string, number>(); // tool name → row index pending result

  for (const e of events) {
    if (e.kind === "phase_started" && isPhase(e.phase)) phase = e.phase;

    if (e.kind === "tool_call") {
      const tool = normalizeToolName(e.tool);
      const message = renderToolCall(tool, e.tool, e.input);
      const row: EnrichedRow = {
        id: e.id,
        ts: new Date(e.ts),
        phase,
        message,
        expandable: true,
        statusBadge: "pending",
        detail: { input: e.input },
      };
      rows.push(row);
      callRowIdx.set(e.tool, rows.length - 1);
      continue;
    }

    if (e.kind === "tool_result") {
      const idx = callRowIdx.get(e.tool);
      if (idx !== undefined) {
        const row = rows[idx]!;
        row.statusBadge = e.ok ? "ok" : "fail";
        const bash = extractBashDetail(e.tool, e.output);
        row.detail = {
          ...(row.detail ?? {}),
          ...(e.output !== undefined ? { output: e.output } : {}),
          ...(bash ? { bash } : {}),
        };
        // For write/edit, refine the message with deltas if the result carries them.
        const refined = refineMessageFromResult(row.message, e.tool, e.output);
        if (refined) row.message = refined;
        callRowIdx.delete(e.tool);
      } else {
        // Orphan result (no preceding call captured) — render as a standalone row.
        rows.push({
          id: e.id,
          ts: new Date(e.ts),
          phase,
          message: `${normalizeToolName(e.tool)}`,
          expandable: e.output !== undefined,
          statusBadge: e.ok ? "ok" : "fail",
          ...(e.output !== undefined ? { detail: { output: e.output } } : {}),
        });
      }
      continue;
    }

    rows.push({
      id: e.id,
      ts: new Date(e.ts),
      phase,
      message: renderNonToolMessage(e),
      expandable: false,
    });
  }
  return rows;
}

function isPhase(p: string): p is Phase {
  return (
    p === "intake" ||
    p === "brainstorm" ||
    p === "plan" ||
    p === "code" ||
    p === "verify" ||
    p === "pr"
  );
}

// Map pi SDK tool names (Bash, Read, Write, Edit) and harness aliases to
// stable lowercased forms. Unknown tools pass through lowercased so the user
// still sees them.
function normalizeToolName(tool: string): string {
  const t = tool.toLowerCase();
  if (t === "bash" || t === "shell") return "bash";
  if (t === "read" || t === "read_file") return "read";
  if (t === "write" || t === "write_file") return "write";
  if (t === "edit" || t === "str_replace") return "edit";
  return t;
}

function renderToolCall(tool: string, rawTool: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  switch (tool) {
    case "bash": {
      const cmd = stringField(obj, ["command", "cmd"]);
      return `bash(${truncate(cmd ?? "—", 60)})`;
    }
    case "read": {
      const path = stringField(obj, ["path", "file_path", "file"]);
      return `read(${path ?? "—"})`;
    }
    case "write": {
      const path = stringField(obj, ["path", "file_path", "file"]);
      const content = stringField(obj, ["content", "text"]);
      const lines = content ? content.split("\n").length : undefined;
      return `write(${path ?? "—"}${lines ? ` · ${lines}L` : ""})`;
    }
    case "edit": {
      const path = stringField(obj, ["path", "file_path", "file"]);
      const added = numField(obj, ["added"]);
      const removed = numField(obj, ["removed"]);
      const delta = formatDelta(added, removed);
      return `edit(${path ?? "—"}${delta ? ` ${delta}` : ""})`;
    }
    case "read_repo_layout": {
      const dir = stringField(obj, ["dir", "path"]);
      return `read repo layout · ${dir ?? "—"}`;
    }
    default: {
      const arg = summarizeArg(obj);
      return arg ? `${rawTool}(${arg})` : `${rawTool}()`;
    }
  }
}

function refineMessageFromResult(
  current: string,
  tool: string,
  output: unknown,
): string | null {
  if (output == null || typeof output !== "object") return null;
  const t = normalizeToolName(tool);
  if (t === "write" || t === "edit") {
    const o = output as { added?: number; removed?: number; bytesWritten?: number };
    const added = typeof o.added === "number" ? o.added : undefined;
    const removed = typeof o.removed === "number" ? o.removed : undefined;
    const delta = formatDelta(added, removed);
    if (delta && !current.includes("+") && !current.includes("−")) {
      return current.replace(/\)$/, ` ${delta})`);
    }
  }
  return null;
}

function extractBashDetail(
  tool: string,
  output: unknown,
): { command: string; stdout?: string; stderr?: string; exitCode?: number } | null {
  if (normalizeToolName(tool) !== "bash") return null;
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  const command = stringField(o, ["command", "cmd"]);
  const stdout = stringField(o, ["stdout", "out"]);
  const stderr = stringField(o, ["stderr", "err"]);
  const exitRaw = o["exitCode"] ?? o["exit_code"] ?? o["code"];
  const exitCode = typeof exitRaw === "number" ? exitRaw : undefined;
  if (command === undefined && stdout === undefined && stderr === undefined && exitCode === undefined) {
    return null;
  }
  return {
    command: command ?? "",
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function renderNonToolMessage(e: AgentEvent): string {
  switch (e.kind) {
    case "phase_started":
      return `session opened · ${e.phase}`;
    case "phase_ended":
      return `${e.phase} · ${e.status}`;
    case "log":
      return e.text;
    case "brainstorm_question":
      return `q ${e.questionId} · ${e.options.length} options`;
    case "brainstorm_answer":
      return `answer · ${e.questionId}${e.optionId ? ` → ${e.optionId}` : ""}`;
    case "brainstorm_system":
      return renderBrainstormSystem(e);
    case "brainstorm_revision_requested":
      return "revision requested by user";
    case "message_delta":
      return e.text;
    default:
      return "";
  }
}

function renderBrainstormSystem(
  e: Extract<AgentEvent, { kind: "brainstorm_system" }>,
): string {
  const data = e.data as { reason?: string; status?: string } | undefined;
  switch (e.systemKind) {
    case "probe_complete":
      return "probed repo";
    case "self_critique_passed":
      return "self-critique passed";
    case "status_changed":
      return data?.status === "ready"
        ? "artifacts marked ready"
        : `artifacts status · ${data?.status ?? "unknown"}`;
    case "blocked":
      return `brainstorm blocked · ${data?.reason ?? "unknown reason"}`;
    case "session_reset":
      return `pi session reset · ${data?.reason ?? "unknown reason"}`;
  }
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function numField(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function formatDelta(added?: number, removed?: number): string {
  const parts: string[] = [];
  if (typeof added === "number") parts.push(`+${added}`);
  if (typeof removed === "number" && removed > 0) parts.push(`−${removed}`);
  return parts.join(" ");
}

function summarizeArg(obj: Record<string, unknown>): string | undefined {
  const path = stringField(obj, ["path", "file_path", "file", "dir"]);
  if (path) return path;
  const keys = Object.keys(obj);
  if (keys.length === 0) return undefined;
  return keys.slice(0, 2).join(", ");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function coerceToString(v: unknown): string {
  if (typeof v === "string") return v;
  return prettyJson(v);
}
