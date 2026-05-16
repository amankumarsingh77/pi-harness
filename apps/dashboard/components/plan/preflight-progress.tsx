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
  let latest: { sessionId: string; ended: boolean } | null = null;
  for (const e of events) {
    if (e.kind === "plan_subagent_started" && e.subagent === subagent) {
      latest = { sessionId: e.sessionId, ended: false };
    }
    if (e.kind === "plan_subagent_ended" && e.subagent === subagent) {
      latest = { sessionId: e.sessionId, ended: true };
    }
  }
  if (!latest) return "intake";
  if (!latest.ended) return "progress";
  return "blocked";
}
