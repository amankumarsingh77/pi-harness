import type { PlanJsonlEvent } from "@/lib/api";
import type { PreflightStep } from "@pi-harness/shared";

export const SUBAGENTS: readonly string[] = [
  "codebase-scout",
  "integration-scanner",
  "precedent-locator",
  "claim-verifier",
];

export type DotKind = "intake" | "progress" | "done" | "blocked" | "fallback";

export function deriveKind(
  subagent: string,
  research: Record<string, string | null>,
  events: readonly PlanJsonlEvent[],
  preflightSteps: readonly PreflightStep[] = [],
): DotKind {
  const stepKind = deriveKindFromSteps(subagent, preflightSteps);
  if (stepKind) return stepKind;
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

function deriveKindFromSteps(
  subagent: string,
  preflightSteps: readonly PreflightStep[],
): DotKind | null {
  const step = [...preflightSteps].reverse().find((item) => item.subagent === subagent);
  if (!step) return null;
  if (step.status === "running") return "progress";
  if (step.status === "queued") return "intake";
  if (step.status === "succeeded" || step.status === "skipped") return "done";
  if (step.status === "fallback_succeeded") return "fallback";
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
