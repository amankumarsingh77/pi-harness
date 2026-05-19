"use client";
import type { AgentEvent } from "@pi-harness/shared";
import { useOptionalRunLiveEvents } from "@/lib/run-live-provider";

type ActivityRow = {
  readonly id: string;
  readonly time: string;
  readonly tag: string;
  readonly message: string;
  readonly hint: string;
};

export function TaskActivityPanel({
  events,
  action,
}: {
  readonly events: readonly AgentEvent[];
  readonly action?: React.ReactNode;
}) {
  const live = useOptionalRunLiveEvents();
  const rows = latestActivity(mergeEvents(events, live?.events ?? []));

  return (
    <section className="overflow-hidden rounded-[10px] border border-line bg-white/[0.018]">
      <div className="flex min-h-[42px] items-center justify-between border-b border-line px-3.5">
        <h2 className="m-0 text-[13px] font-semibold text-fg">Latest activity</h2>
        {action}
      </div>
      <div className="py-2.5">
        {rows.length === 0 ? (
          <p className="px-3.5 font-mono text-[11px] text-fg-faint">No activity yet</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="group grid min-h-[31px] grid-cols-[58px_78px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 font-mono text-[11px] text-fg-mute transition-colors hover:bg-white/[0.025]"
            >
              <span className="text-fg-faint">{row.time}</span>
              <span className="text-fg-subtle">{row.tag}</span>
              <span className="truncate text-fg-body">{row.message}</span>
              <span className="text-fg-faint opacity-0 transition-opacity group-hover:opacity-100">
                {row.hint}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function mergeEvents(
  initial: readonly AgentEvent[],
  live: readonly AgentEvent[],
): readonly AgentEvent[] {
  const byId = new Map<string, AgentEvent>();
  for (const event of initial) byId.set(event.id, event);
  for (const event of live) byId.set(event.id, event);
  return [...byId.values()];
}

function latestActivity(events: readonly AgentEvent[]): readonly ActivityRow[] {
  return [...events]
    .filter((event) => event.kind !== "message_delta")
    .sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime())
    .slice(0, 5)
    .map(activityRow);
}

function activityRow(event: AgentEvent): ActivityRow {
  return {
    id: event.id,
    time: formatTime(event.ts),
    tag: tagForEvent(event),
    message: messageForEvent(event),
    hint: hintForEvent(event),
  };
}

function tagForEvent(event: AgentEvent): string {
  switch (event.kind) {
    case "phase_started":
    case "phase_ended":
      return event.phase;
    case "tool_call":
    case "tool_result":
      return event.tool;
    case "log":
      return event.level;
    case "brainstorm_question":
    case "brainstorm_answer":
    case "brainstorm_system":
    case "brainstorm_revision_requested":
    case "brainstorm_user_nudge":
    case "brainstorm_agent_reply":
    case "brainstorm_mock_proposed":
    case "brainstorm_mock_revised":
    case "brainstorm_mock_selected":
    case "brainstorm_mock_edit_requested":
    case "brainstorm_usage":
    case "brainstorm_artifact_edited":
      return "brainstorm";
    case "plan_system":
    case "plan_subagent_started":
    case "plan_subagent_ended":
    case "plan_revision_requested":
    case "plan_usage":
    case "plan_artifact_edited":
      return "plan";
    case "code_node_started":
    case "code_node_ended":
    case "code_usage":
      return "code";
    case "message_delta":
      return "stream";
  }
}

function messageForEvent(event: AgentEvent): string {
  switch (event.kind) {
    case "phase_started":
      return `session opened · ${event.phase}`;
    case "phase_ended":
      return `${event.phase} · ${event.status}`;
    case "tool_call":
      return `tool call · ${event.tool}`;
    case "tool_result":
      return `${event.tool} · ${event.ok ? "completed" : "failed"}`;
    case "log":
      return event.text;
    case "brainstorm_question":
      return `question · ${event.prompt}`;
    case "brainstorm_answer":
      return `answer · ${event.questionId}`;
    case "brainstorm_system":
      return `brainstorm · ${event.systemKind}`;
    case "brainstorm_revision_requested":
      return "brainstorm revision requested";
    case "brainstorm_user_nudge":
      return "user note added";
    case "brainstorm_agent_reply":
      return event.message;
    case "brainstorm_mock_proposed":
      return `mock proposed · ${event.mock.title}`;
    case "brainstorm_mock_revised":
      return `mock revised · ${event.mock.title}`;
    case "brainstorm_mock_selected":
      return `mock selected · ${event.mockId}`;
    case "brainstorm_mock_edit_requested":
      return "mock edit requested";
    case "brainstorm_usage":
      return `brainstorm usage · ${event.cumulativeInputTokens} in`;
    case "brainstorm_artifact_edited":
      return `${event.artifact}.md edited`;
    case "plan_system":
      return `plan · ${event.systemKind}`;
    case "plan_subagent_started":
      return `${event.subagent} started`;
    case "plan_subagent_ended":
      return `${event.subagent} ${event.ok ? "completed" : "failed"}`;
    case "plan_revision_requested":
      return "plan revision requested";
    case "plan_usage":
      return `plan usage · ${event.cumulativeInputTokens} in`;
    case "plan_artifact_edited":
      return `${event.artifact}.md edited`;
    case "code_node_started":
      return `${event.nodeId} started`;
    case "code_node_ended":
      return `${event.nodeId} ${event.status}`;
    case "code_usage":
      return `code usage · ${event.inputTokens} in`;
    case "message_delta":
      return event.text;
  }
}

function hintForEvent(event: AgentEvent): string {
  if (event.kind === "tool_call" || event.kind === "tool_result") return "inspect";
  if (event.kind === "plan_system" || event.kind === "plan_artifact_edited") return "plan";
  if (event.kind.startsWith("code")) return "code";
  if (event.kind.startsWith("brainstorm")) return "brainstorm";
  return "open";
}

function formatTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toISOString().slice(11, 16);
}
