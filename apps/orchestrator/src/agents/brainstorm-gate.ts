import { join } from "node:path";
import { readJsonl } from "../adapters/jsonl-writer.js";
import type { ArtifactsStore } from "./artifacts-store.js";

// Derived per-task brainstorm gate. Replaces the persisted `awaitingApproval`
// boolean. The gate is a pure function of the underlying facts:
//
//   artifactsReady = design.fm.status === "ready" && spec.fm.status === "ready"
//   lastReadyAt    = ts of latest brainstorm_system{status_changed,status:ready}
//   lastRevisionAt = ts of latest brainstorm_revision_requested
//
// gate = "awaiting_user" when artifacts are ready AND no revision has been
// filed since the last ready event. Otherwise "running" — including the
// "user clicked Request changes after the agent flipped to ready" case,
// which would previously flip awaitingApproval back to true on the next
// no-op tick because the artifacts on disk still carried status: ready.
export type BrainstormGate = "running" | "awaiting_user";

type JsonlEvent = Record<string, unknown> & { ts?: string; kind?: string };

export async function deriveBrainstormGate(
  cwd: string,
  taskId: string,
  store: ArtifactsStore,
): Promise<BrainstormGate> {
  const [design, spec] = await Promise.all([
    store.readArtifact(cwd, taskId, "design"),
    store.readArtifact(cwd, taskId, "spec"),
  ]);
  // Both artifacts must be ready *or* human_edited. The latter accepts the
  // edit-in-place path: a user-authored body is enough to unblock approval
  // even if the agent never re-marked the artifact ready after the edit.
  const isApprovable = (s: string | undefined): boolean =>
    s === "ready" || s === "human_edited";
  const artifactsReady =
    isApprovable(design?.fm.status) && isApprovable(spec?.fm.status);
  if (!artifactsReady) return "running";

  const events = await readJsonl<JsonlEvent>(
    join(cwd, ".harness", taskId, "brainstorm.jsonl"),
  );

  const lastReadyAt = lastTs(events, isReadyEvent);
  const lastRevisionAt = lastTs(events, isRevisionEvent);

  // Revision after the last ready invalidates the gate. If we have artifacts
  // marked ready but no ready event in the JSONL, the artifacts predate the
  // current event log (test fixtures, manual edits) — accept ready.
  if (lastRevisionAt !== null && (lastReadyAt === null || lastRevisionAt > lastReadyAt)) {
    return "running";
  }
  return "awaiting_user";
}

function isReadyEvent(e: JsonlEvent): boolean {
  if (e.kind !== "brainstorm_system") return false;
  if (e["systemKind"] !== "status_changed") return false;
  const data = e["data"] as { status?: string } | undefined;
  return data?.status === "ready";
}

function isRevisionEvent(e: JsonlEvent): boolean {
  return e.kind === "brainstorm_revision_requested";
}

function lastTs(events: JsonlEvent[], pred: (e: JsonlEvent) => boolean): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (pred(e) && typeof e.ts === "string") return e.ts;
  }
  return null;
}
