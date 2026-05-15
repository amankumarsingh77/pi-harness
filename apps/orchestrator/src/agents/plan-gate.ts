import { join } from "node:path";
import { readJsonl } from "../adapters/jsonl-writer.js";
import type { ArtifactsStore } from "./artifacts-store.js";

// Derived per-task plan gate. Mirrors brainstorm-gate exactly: pure function
// of artifact frontmatter + plan.jsonl ordering. No persisted boolean.
//
//   artifactsReady = plan.fm.status ∈ {ready, human_edited, approved} AND
//                    scenarios.fm.status ∈ {ready, human_edited, approved} AND
//                    blast-radius.fm.status ∈ {ready, human_edited, approved}
//   lastReadyAt    = ts of latest plan_system{status_changed, status:ready}
//   lastRevisionAt = ts of latest plan_revision_requested
//
// gate = "awaiting_user" when artifacts are ready AND no revision filed
// since the last ready event. Otherwise "running".
export type PlanGate = "running" | "awaiting_user";

type JsonlEvent = Record<string, unknown> & { ts?: string; kind?: string };

export async function derivePlanGate(
  cwd: string,
  taskId: string,
  store: ArtifactsStore,
): Promise<PlanGate> {
  const [plan, scenarios, blastRadius] = await Promise.all([
    store.readArtifact(cwd, taskId, "plan"),
    store.readArtifact(cwd, taskId, "scenarios"),
    store.readArtifact(cwd, taskId, "blast-radius"),
  ]);
  // Ready, human-edited, or approved all unblock the gate. `approved` is
  // included so that re-derivations after the user clicks Approve remain
  // stable (the route flips both artifacts to approved).
  const isApprovable = (s: string | undefined): boolean =>
    s === "ready" || s === "human_edited" || s === "approved";
  const artifactsReady =
    isApprovable(plan?.fm.status) &&
    isApprovable(scenarios?.fm.status) &&
    isApprovable(blastRadius?.fm.status);
  if (!artifactsReady) return "running";

  const events = await readJsonl<JsonlEvent>(
    join(cwd, ".harness", taskId, "plan.jsonl"),
  );

  const lastReadyAt = lastTs(events, isReadyEvent);
  const lastRevisionAt = lastTs(events, isRevisionEvent);

  if (lastRevisionAt !== null && (lastReadyAt === null || lastRevisionAt > lastReadyAt)) {
    return "running";
  }
  return "awaiting_user";
}

function isReadyEvent(e: JsonlEvent): boolean {
  if (e.kind !== "plan_system") return false;
  if (e["systemKind"] !== "status_changed") return false;
  const data = e["data"] as { status?: string } | undefined;
  return data?.status === "ready";
}

function isRevisionEvent(e: JsonlEvent): boolean {
  return e.kind === "plan_revision_requested";
}

function lastTs(events: JsonlEvent[], pred: (e: JsonlEvent) => boolean): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (pred(e) && typeof e.ts === "string") return e.ts;
  }
  return null;
}
