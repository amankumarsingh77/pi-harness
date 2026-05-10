"use client";

// Single line above the awaiting-approval banner that surfaces what the agent
// is doing between questions. Driven by SSE tool_call/tool_result events;
// reduces dead-air silence to "agent is reading X" or "agent is thinking".
//
// State shape:
//   - { kind: "running"; tool; arg }   active tool call within the last 60s
//   - { kind: "thinking" }              tool call older than 60s with no result
//   - null                              no in-flight call; component renders nothing
export type ActivityState =
  | { kind: "running"; tool: string; arg: string }
  | { kind: "thinking" }
  | null;

export function ActivityLine({ activity }: { activity: ActivityState }) {
  if (activity === null) return null;
  if (activity.kind === "thinking") {
    return (
      <div className="flex items-center gap-2 font-mono text-[11px] text-fg-mute">
        <span className="tick-anim">·</span>
        <span>thinking…</span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 font-mono text-[11px] text-fg-mute"
      data-testid="activity-line"
    >
      <span className="tick-anim">·</span>
      <span className="truncate">
        <span className="text-fg-body">{activity.tool}</span>
        {activity.arg ? <span className="text-fg-subtle"> {activity.arg}</span> : null}
      </span>
    </div>
  );
}

// Picks the most recent tool_call whose toolCallId-equivalent has no later
// tool_result. Without a real toolCallId we match by (tool, position): a
// tool_result for the same tool that arrives after a tool_call clears it.
// Returns the activity state to render. The 60s threshold flips the line to
// "thinking" so a hung call doesn't masquerade as active.
export function deriveActivity(
  events: ReadonlyArray<{ kind: string; tool?: string; input?: unknown; ts: Date | string }>,
  now: number,
): ActivityState {
  let lastCallIdx = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.kind === "tool_call") {
      lastCallIdx = i;
      break;
    }
  }
  if (lastCallIdx === -1) return null;
  const call = events[lastCallIdx]!;
  // Look for a same-tool tool_result *after* the call.
  const resolvedAfter = events.slice(lastCallIdx + 1).some(
    (e) => e.kind === "tool_result" && e.tool === call.tool,
  );
  if (resolvedAfter) return null;
  const ts = call.ts instanceof Date ? call.ts.getTime() : new Date(call.ts).getTime();
  if (Number.isFinite(ts) && now - ts > 60_000) {
    return { kind: "thinking" };
  }
  return {
    kind: "running",
    tool: String(call.tool ?? "tool"),
    arg: summarizeArg(call.tool, call.input),
  };
}

function summarizeArg(tool: string | undefined, input: unknown): string {
  if (input === null || input === undefined) return "";
  const obj = typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!obj) return clip(String(input), 80);
  switch (tool) {
    case "read":
    case "read_file": {
      const path = obj["path"] ?? obj["filePath"] ?? obj["file_path"];
      return clip(typeof path === "string" ? path : "", 80);
    }
    case "bash": {
      const cmd = obj["command"];
      return clip(typeof cmd === "string" ? cmd : "", 80);
    }
    case "glob": {
      const pat = obj["pattern"];
      return clip(typeof pat === "string" ? pat : "", 80);
    }
    case "grep": {
      const pat = obj["pattern"] ?? obj["query"];
      return clip(typeof pat === "string" ? pat : "", 80);
    }
    case "write":
    case "edit": {
      const path = obj["path"] ?? obj["filePath"] ?? obj["file_path"];
      return clip(typeof path === "string" ? path : "", 80);
    }
    default:
      return "";
  }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
