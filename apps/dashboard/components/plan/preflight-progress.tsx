import type { PlanJsonlEvent } from "@/lib/api";

export const SUBAGENTS: readonly string[] = [
  "codebase-scout",
  "integration-scanner",
  "precedent-locator",
  "claim-verifier",
];

export type DotKind = "intake" | "progress" | "done" | "blocked";

export function deriveKind(
  subagent: string,
  research: Record<string, string | null>,
  events: readonly PlanJsonlEvent[],
): DotKind {
  if (research[subagent]) return "done";
  const attemptId = latestPreflightAttemptId(events);
  let latest: { sessionId: string; ended: boolean } | null = null;
  for (const event of events) {
    if (!matchesAttempt(event, attemptId)) continue;
    if (event.kind === "plan_subagent_started" && event.subagent === subagent) {
      latest = { sessionId: event.sessionId, ended: false };
    }
    if (event.kind === "plan_subagent_ended" && event.subagent === subagent) {
      latest = { sessionId: event.sessionId, ended: true };
    }
  }
  if (!latest) return "intake";
  if (!latest.ended) return "progress";
  return "blocked";
}

function latestPreflightAttemptId(events: readonly PlanJsonlEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.kind !== "plan_system" || event.systemKind !== "preflight_started") continue;
    const attemptId = event.data?.attemptId;
    return typeof attemptId === "string" ? attemptId : null;
  }
  return null;
}

function matchesAttempt(event: PlanJsonlEvent, latestAttemptId: string | null): boolean {
  if (latestAttemptId === null) return true;
  if (event.kind !== "plan_subagent_started" && event.kind !== "plan_subagent_ended") return true;
  return event.attemptId === latestAttemptId;
}
