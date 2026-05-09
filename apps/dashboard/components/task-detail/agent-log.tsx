"use client";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { AgentEvent } from "@pi-harness/shared";

/**
 * Live agent log. Three-column grid: timestamp · phase · message. Phase is
 * derived from the most-recent `phase_started` event; phases color-code
 * (brainstorm/plan in mute, code in progress-blue, verify in review-yellow).
 *
 * Header carries autoscroll/wrap toggles. Composer-style toggles intentional —
 * they're the only chrome on the page that the user actually flips.
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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoscroll) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, autoscroll]);

  // Walk events and tag each with its phase + a render-friendly message.
  const rows = enrichEvents(events);
  const lastIdx = rows.length - 1;

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
            {runId.slice(0, 6)} · {events.length} events
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto py-2 font-mono text-xs leading-relaxed">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className={clsx(
              "grid grid-cols-[76px_86px_1fr] gap-3.5 px-6 py-px hover:bg-white/[0.02]",
              i === lastIdx && live && "text-fg",
            )}
          >
            <span className={clsx("text-fg-faint", i === lastIdx && live && "before:mr-1 before:text-st-progress before:content-['▸']")}>
              {formatTime(row.ts)}
            </span>
            <span className={clsx("lowercase", PHASE_COLOR[row.phase])}>{row.phase}</span>
            <span className={clsx("text-fg-body", wrap ? "whitespace-pre-wrap break-words" : "truncate")}>
              <Message text={row.message} />
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
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
        style={on ? { background: "var(--color-st-progress)", borderColor: "var(--color-st-progress)" } : undefined}
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

/** Render the message, lifting any file-path-looking tokens into highlighted chips. */
function Message({ text }: { text: string }) {
  // Fast path: no path tokens → render as a single text node so screen readers
  // and test-library text matchers see the message as one string.
  const PATH_RE = /\b[\w./-]+\.(?:ts|tsx|md|json)\b/g;
  if (!PATH_RE.test(text)) return <>{text}</>;

  // Walk segments around the matches, emitting a chip span for each path.
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

type EnrichedRow = {
  id: string;
  ts: Date;
  phase: Phase;
  message: string;
};

function enrichEvents(events: AgentEvent[]): EnrichedRow[] {
  let phase: Phase = "intake";
  const rows: EnrichedRow[] = [];
  for (const e of events) {
    if (e.kind === "phase_started" && isPhase(e.phase)) phase = e.phase;
    rows.push({
      id: e.id,
      ts: new Date(e.ts),
      phase,
      message: renderMessage(e),
    });
  }
  return rows;
}

function isPhase(p: string): p is Phase {
  return p === "intake" || p === "brainstorm" || p === "plan" || p === "code" || p === "verify" || p === "pr";
}

function renderMessage(e: AgentEvent): string {
  switch (e.kind) {
    case "phase_started":
      return `session opened · ${e.phase}`;
    case "phase_ended":
      return `${e.phase} · ${e.status}`;
    case "tool_call": {
      const input = e.input as { path?: string; added?: number; removed?: number; dir?: string } | null;
      if (e.tool === "edit" && input?.path) {
        const delta = `${input.added !== undefined ? `+${input.added}` : ""}${
          input.removed !== undefined ? ` -${input.removed}` : ""
        }`;
        return `edit ${input.path} ${delta}`.trim();
      }
      if (e.tool === "read_repo_layout" && input?.dir) {
        return `read repo layout · ${input.dir}`;
      }
      return `${e.tool} call`;
    }
    case "tool_result":
      if (e.tool === "vitest") return `test runner · ${e.ok ? "passed" : "failing"}`;
      if (e.tool === "write_artifact") return `✓ artifact written`;
      return `${e.tool} · ${e.ok ? "ok" : "failed"}`;
    case "message_delta":
      return e.text;
    case "log":
      return e.text;
    case "brainstorm_question":
      return `q ${e.questionId} · ${e.options.length} options`;
    case "brainstorm_answer":
      return `answer · ${e.questionId}${e.optionId ? ` → ${e.optionId}` : ""}`;
    case "brainstorm_system":
      return `brainstorm · ${e.systemKind}`;
    case "brainstorm_revision_requested":
      return `revision requested`;
  }
}
