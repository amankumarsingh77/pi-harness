"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentEvent, PreflightStep } from "@pi-harness/shared";
import type { PlanJsonlEvent } from "@/lib/api";
import { StatusIcon } from "@/components/kanban/status-icon";
import { CancelPhaseRunButton } from "@/components/task-detail/cancel-phase-run-button";
import { AgentFindings } from "./agent-findings";
import { SUBAGENTS, deriveKind, type DotKind } from "./preflight-progress";
import { buildLogRows, LogRows, RawJsonlRows } from "./plan-log-rows";

type AgentSummary = {
  readonly name: string;
  readonly kind: DotKind;
  readonly events: readonly AgentEvent[];
  readonly findingsBody: string | null;
  readonly meta: readonly string[];
  readonly step: PreflightStep | null;
};

type DrawerTab = "timeline" | "findings" | "raw";

export function PreflightAgentConsole({
  taskId,
  canCancelRun,
  research,
  planEvents,
  liveEvents,
  preflightSteps = [],
}: {
  readonly taskId: string;
  readonly canCancelRun: boolean;
  readonly research: Record<string, string | null>;
  readonly planEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly preflightSteps?: readonly PreflightStep[];
}) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("timeline");
  const lifecycleEvents = useMemo(
    () => [...planEvents, ...liveEventsToPlanEvents(liveEvents)],
    [planEvents, liveEvents],
  );
  const summaries = useMemo(
    () =>
      SUBAGENTS.map((name) =>
        buildAgentSummary({
          name,
          research,
          lifecycleEvents,
          liveEvents,
          preflightSteps,
        }),
      ),
    [research, lifecycleEvents, liveEvents, preflightSteps],
  );
  const selectedSummary =
    selectedAgent === null
      ? null
      : summaries.find((summary) => summary.name === selectedAgent) ?? null;

  const counts = {
    done: summaries.filter((summary) => summary.kind === "done").length,
    progress: summaries.filter((summary) => summary.kind === "progress").length,
    fallback: summaries.filter((summary) => summary.kind === "fallback").length,
    queued: summaries.filter((summary) => summary.kind === "intake").length,
    blocked: summaries.filter((summary) => summary.kind === "blocked").length,
  };

  return (
    <>
      <section
        className="mb-3 grid grid-cols-1 items-center gap-3 rounded-[9px] border border-line bg-white/[0.018] px-3 py-2.5 lg:grid-cols-[auto_minmax(0,1fr)_auto]"
        aria-label="Preflight agent navigation"
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.075em] text-fg-mute">
          preflight agents
        </div>
        <div className="scroll-hide flex min-w-0 gap-1.5 overflow-x-auto">
          {summaries.map((summary) => (
            <button
              key={summary.name}
              type="button"
              className="inline-flex min-h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-line bg-transparent px-2 font-mono text-[11px] text-fg-mute transition hover:border-line-hover hover:bg-card hover:text-fg-body"
              onClick={() => {
                setSelectedAgent(summary.name);
                setTab(summary.findingsBody === null ? "timeline" : "findings");
              }}
            >
              <StatusIcon kind={statusIconKind(summary.kind)} size={12} live={summary.kind === "progress"} />
              {summary.name}
            </button>
          ))}
        </div>
        <div className="whitespace-nowrap font-mono text-[11px] text-fg-mute">
          {counts.done} done · {counts.progress} live · {counts.queued} queued
          {counts.fallback > 0 ? ` · ${counts.fallback} fallback` : ""}
          {counts.blocked > 0 ? ` · ${counts.blocked} blocked` : ""}
        </div>
      </section>

      <section
        className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2"
        aria-label="Live preflight logs"
      >
        {summaries.map((summary) => (
          <AgentPane
            key={summary.name}
            summary={summary}
            taskId={taskId}
            canCancelRun={canCancelRun}
            onOpen={(agentName) => {
              setSelectedAgent(agentName);
              setTab(summary.findingsBody === null ? "timeline" : "findings");
            }}
          />
        ))}
      </section>

      {selectedSummary && (
        <AgentDrawer
          summary={selectedSummary}
          tab={tab}
          onTabChange={setTab}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </>
  );
}

function AgentPane({
  summary,
  taskId,
  canCancelRun,
  onOpen,
}: {
  readonly summary: AgentSummary;
  readonly taskId: string;
  readonly canCancelRun: boolean;
  readonly onOpen: (agentName: string) => void;
}) {
  const rows = buildLogRows(summary.events);

  return (
    <article
      className={[
        "min-h-[250px] overflow-hidden rounded-[9px] border bg-card",
        summary.kind === "progress"
          ? "border-st-progress/30 shadow-[0_0_0_1px_rgba(94,106,210,0.05),0_18px_40px_rgba(0,0,0,0.18)]"
          : "border-line",
      ].join(" ")}
      aria-label={`${summary.name} preflight agent`}
    >
      <header className="flex items-start gap-2.5 border-b border-line px-3 py-3">
        <StatusIcon
          kind={statusIconKind(summary.kind)}
          size={14}
          live={summary.kind === "progress"}
        />
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px] font-semibold text-fg">
            {summary.name}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-[10.5px] text-fg-mute">
            {summary.meta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {canCancelRun && summary.kind === "progress" && (
            <CancelPhaseRunButton
              taskId={taskId}
              phase="plan"
              disabled={false}
              compact
              source="preflight-agent"
            />
          )}
          <button
            type="button"
            className="min-h-6.5 rounded-[7px] border border-line bg-white/2 px-2 font-mono text-[10.5px] text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/[0.045]"
            onClick={() => onOpen(summary.name)}
          >
            {summary.kind === "progress" ? "Follow live" : "Full log"}
          </button>
        </div>
      </header>

      <div className="scroll-hide h-43.5 overflow-y-auto px-3 py-2.5">
        <LogRows rows={rows} limit={8} emptyText={emptyTextFor(summary.kind)} />
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5 font-mono text-[10.5px] text-fg-mute">
        <span className="truncate">{findingsPreview(summary)}</span>
        <button
          type="button"
          className="rounded-[7px] border border-line bg-white/2 px-2 py-1 text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/4.5"
          onClick={() => onOpen(summary.name)}
        >
          Findings
        </button>
      </footer>
    </article>
  );
}

function AgentDrawer({
  summary,
  tab,
  onTabChange,
  onClose,
}: {
  readonly summary: AgentSummary;
  readonly tab: DrawerTab;
  readonly onTabChange: (tab: DrawerTab) => void;
  readonly onClose: () => void;
}) {
  const rows = buildLogRows(summary.events);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 flex h-full w-[min(560px,calc(100vw-20px))] flex-col border-l border-line-strong bg-card shadow-[-24px_0_90px_rgba(0,0,0,0.54)]"
        role="dialog"
        aria-modal="true"
        aria-label={`${summary.name} full log`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <StatusIcon
            kind={statusIconKind(summary.kind)}
            size={14}
            live={summary.kind === "progress"}
          />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-fg">{summary.name}</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-fg-mute">
              {summary.meta.join(" · ")}
            </div>
          </div>
          <button
            type="button"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-mute transition hover:bg-card-hover hover:text-fg"
            aria-label="Close agent drawer"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <nav className="flex border-b border-line px-4">
          <DrawerTabButton active={tab === "timeline"} onClick={() => onTabChange("timeline")}>
            Timeline
          </DrawerTabButton>
          <DrawerTabButton active={tab === "findings"} onClick={() => onTabChange("findings")}>
            Findings
          </DrawerTabButton>
          <DrawerTabButton active={tab === "raw"} onClick={() => onTabChange("raw")}>
            Raw JSONL
          </DrawerTabButton>
        </nav>

        <div className="scroll-hide min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === "timeline" && <LogRows rows={rows} emptyText={emptyTextFor(summary.kind)} />}
          {tab === "findings" && <AgentFindings body={summary.findingsBody} />}
          {tab === "raw" && (
            <RawJsonlRows events={summary.events} emptyText="no raw agent events yet" />
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerTabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={[
        "-mb-px border-b-[1.5px] px-3 py-2.5 text-[12px]",
        active
          ? "border-fg text-fg"
          : "border-transparent text-fg-mute hover:text-fg",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function buildAgentSummary({
  name,
  research,
  lifecycleEvents,
  liveEvents,
  preflightSteps,
}: {
  readonly name: string;
  readonly research: Record<string, string | null>;
  readonly lifecycleEvents: readonly PlanJsonlEvent[];
  readonly liveEvents: readonly AgentEvent[];
  readonly preflightSteps: readonly PreflightStep[];
}): AgentSummary {
  const kind = deriveKind(name, research, lifecycleEvents, preflightSteps);
  const agentEvents = liveEvents.filter((event) => eventHasSubagent(event, name));
  const ended = latestEnded(name, lifecycleEvents);
  const started = latestStarted(name, lifecycleEvents);
  const step = latestStep(name, preflightSteps);
  const durationMs =
    ended?.durationMs ??
    stepDurationMs(step) ??
    (started ? Math.max(0, Date.now() - new Date(started.ts).getTime()) : 0);
  const cost = ended?.costUsd ?? step?.costUsd ?? 0;
  const toolCalls = agentEvents.filter((event) => event.kind === "tool_call").length;
  const findingsBody = research[name] ?? null;

  return {
    name,
    kind,
    events: agentEvents,
    findingsBody,
    step,
    meta: buildMeta({ kind, durationMs, cost, toolCalls, error: step?.error ?? null }),
  };
}

function buildMeta({
  kind,
  durationMs,
  cost,
  toolCalls,
  error,
}: {
  readonly kind: DotKind;
  readonly durationMs: number;
  readonly cost: number;
  readonly toolCalls: number;
  readonly error: string | null;
}): readonly string[] {
  const status = kind === "intake" ? "queued" : kind === "progress" ? "live" : kind;
  return [
    durationMs > 0 ? `${status} · ${formatDuration(durationMs)}` : status,
    cost > 0 ? `$${cost.toFixed(3)}` : null,
    toolCalls > 0 ? `${toolCalls} call${toolCalls === 1 ? "" : "s"}` : null,
    error ? shortError(error) : null,
  ].filter((item): item is string => item !== null);
}

function liveEventsToPlanEvents(events: readonly AgentEvent[]): readonly PlanJsonlEvent[] {
  return events.flatMap((event): readonly PlanJsonlEvent[] => {
    if (event.kind === "plan_subagent_started") {
      return [
        {
          kind: "plan_subagent_started",
          ts: toEventDate(event.ts).toISOString(),
          subagent: event.subagent,
          sessionId: event.sessionId,
          ...(event.attemptId ? { attemptId: event.attemptId } : {}),
        },
      ];
    }
    if (event.kind === "plan_subagent_ended") {
      return [
        {
          kind: "plan_subagent_ended",
          ts: toEventDate(event.ts).toISOString(),
          subagent: event.subagent,
          sessionId: event.sessionId,
          ok: event.ok,
          durationMs: event.durationMs,
          costUsd: event.costUsd,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.attemptId ? { attemptId: event.attemptId } : {}),
          ...(event.error ? { error: event.error } : {}),
        },
      ];
    }
    return [];
  });
}

function eventHasSubagent(event: AgentEvent, subagent: string): boolean {
  return (
    (event.kind === "tool_call" ||
      event.kind === "tool_result" ||
      event.kind === "message_delta" ||
      event.kind === "log") &&
    event.subagent === subagent
  );
}

function latestStarted(
  subagent: string,
  events: readonly PlanJsonlEvent[],
): Extract<PlanJsonlEvent, { kind: "plan_subagent_started" }> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind === "plan_subagent_started" && event.subagent === subagent) {
      return event;
    }
  }
  return null;
}

function latestEnded(
  subagent: string,
  events: readonly PlanJsonlEvent[],
): Extract<PlanJsonlEvent, { kind: "plan_subagent_ended" }> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind === "plan_subagent_ended" && event.subagent === subagent) {
      return event;
    }
  }
  return null;
}

function latestStep(subagent: string, steps: readonly PreflightStep[]): PreflightStep | null {
  return [...steps].reverse().find((step) => step.subagent === subagent) ?? null;
}

function stepDurationMs(step: PreflightStep | null): number | null {
  if (!step) return null;
  const startedAt = toEventDate(step.startedAt).getTime();
  const endedAt = step.endedAt ? toEventDate(step.endedAt).getTime() : Date.now();
  return Math.max(0, endedAt - startedAt);
}

function statusIconKind(kind: DotKind): "intake" | "progress" | "review" | "done" | "blocked" {
  if (kind === "fallback") return "review";
  return kind;
}

function emptyTextFor(kind: DotKind): string {
  if (kind === "intake") return "waiting for this preflight agent to start";
  if (kind === "fallback") return "fallback findings were written after bounded retry";
  return "no tool calls yet";
}

function findingsPreview(summary: AgentSummary): string {
  if (summary.findingsBody) {
    return `Finding: ${summary.findingsBody.replace(/\s+/g, " ").trim().slice(0, 92)}`;
  }
  if (summary.kind === "intake") return "No findings yet.";
  if (summary.kind === "progress") return "Live: findings will appear once the agent finishes.";
  if (summary.kind === "fallback") return "Fallback findings written after bounded retry.";
  return "Findings were not written.";
}

function shortError(error: string): string {
  return error.length > 72 ? `${error.slice(0, 69)}...` : error;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function toEventDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
