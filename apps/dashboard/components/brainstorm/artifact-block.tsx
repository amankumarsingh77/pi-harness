"use client";
import { useEffect, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Artifact, TaskStatus } from "@pi-harness/shared";
import { ArtifactMarkdown } from "@/components/artifact-markdown";
import { api, type BrainstormDiff } from "@/lib/api";
import { submitArtifactEditAction } from "@/app/tasks/[id]/actions";
import { StatusBadge } from "./status-badge";
import { DiffView } from "./diff-view";

// Same shape as lib/client/queries.ts — rewrite /api/* → /api/proxy/* so
// the orchestrator URL stays server-side.
const client = api({
  baseUrl: "",
  fetch: (input, init) =>
    fetch(typeof input === "string" ? input.replace(/^\/api\//, "/api/proxy/") : input, init),
});

// Single artifact pane (design.md or spec.md). Holds the Final | Diff
// toggle state. Diff mode fetches via TanStack Query against the orchestrator
// proxy; the DiffView component renders a line-level diff client-side.
//
// last_updated drives the React Query cache key so the diff refetches on
// every artifact write — no stale data when the agent updates the body.
export function ArtifactBlock({
  taskId,
  kind,
  artifact,
  taskStatus,
  agentBusy = false,
}: {
  taskId: string;
  kind: "design" | "spec";
  artifact: Artifact | null;
  taskStatus: TaskStatus;
  agentBusy?: boolean;
}) {
  const [mode, setMode] = useState<"final" | "diff" | "edit">("final");
  const [editBuffer, setEditBuffer] = useState<string>("");
  const [pending, start] = useTransition();
  const lastUpdated = artifact?.fm.last_updated ?? null;
  // Disable Edit while the agent is mid-tick: a concurrent agent `write`
  // would race the user's save and one would clobber the other.
  const editable = taskStatus === "brainstorming" && !agentBusy;

  // Reset the edit buffer whenever a new artifact body lands. Without this,
  // toggling Edit → Cancel → Edit shows the previous edit in progress.
  useEffect(() => {
    if (artifact && mode !== "edit") setEditBuffer(artifact.body);
  }, [artifact, mode]);

  const submitEdit = (): void => {
    if (!artifact) return;
    const next = editBuffer;
    if (next === artifact.body) {
      setMode("final");
      return;
    }
    start(async () => {
      await submitArtifactEditAction(taskId, kind, next);
      setMode("final");
    });
  };

  const diffQuery = useQuery<BrainstormDiff>({
    queryKey: ["brainstorm-diff", taskId, kind, lastUpdated],
    queryFn: () => client.getBrainstormDiff(taskId, kind),
    enabled: mode === "diff" && artifact !== null,
    staleTime: 5_000,
  });

  return (
    <section className="flex min-h-0 flex-1 basis-0 flex-col border-b border-line last:border-0">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-subtle">
        <span>{kind}.md</span>
        {artifact && <StatusBadge status={artifact.fm.status} />}
        {artifact && (
          <>
            <span className="text-[10.5px] text-fg-faint normal-case tracking-normal">
              updated{" "}
              {new Date(artifact.fm.last_updated).toLocaleTimeString([], { hour12: false })}
              {artifact.fm.last_updated_by && <> · {artifact.fm.last_updated_by}</>}
            </span>
            <div
              className="ml-auto flex items-center gap-1 normal-case tracking-normal"
              role="tablist"
              aria-label={`${kind} view mode`}
            >
              <ModeToggle
                label="Final"
                active={mode === "final"}
                onClick={() => setMode("final")}
              />
              <ModeToggle
                label="Diff"
                active={mode === "diff"}
                onClick={() => setMode("diff")}
              />
              {editable && (
                <ModeToggle
                  label="Edit"
                  active={mode === "edit"}
                  onClick={() => {
                    setEditBuffer(artifact.body);
                    setMode("edit");
                  }}
                />
              )}
            </div>
          </>
        )}
      </header>
      {artifact ? (
        mode === "final" ? (
          <ArtifactMarkdown className="scroll-hide min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {artifact.body}
          </ArtifactMarkdown>
        ) : mode === "diff" ? (
          <DiffPane diff={diffQuery.data} loading={diffQuery.isPending} fallback={artifact.body} />
        ) : (
          <div
            className="flex min-h-0 flex-1 flex-col"
            data-testid={`edit-pane-${kind}`}
          >
            <textarea
              aria-label={`Edit ${kind} body`}
              className="scroll-hide min-h-0 flex-1 resize-none border-0 bg-bg p-4 font-mono text-[12.5px] leading-[1.55] text-fg outline-none disabled:opacity-55"
              value={editBuffer}
              onChange={(e) => setEditBuffer(e.target.value)}
              disabled={pending}
            />
            <div className="flex items-center justify-end gap-1.5 border-t border-line bg-card px-4 py-2">
              <span className="mr-auto font-mono text-[10.5px] text-fg-mute">
                {editBuffer.length}/{64_000}
              </span>
              <button
                type="button"
                onClick={() => {
                  setMode("final");
                  setEditBuffer(artifact.body);
                }}
                disabled={pending}
                className="rounded border border-line px-2.5 py-1 text-[11.5px] text-fg-body hover:border-line-hover hover:bg-white/[0.03] disabled:opacity-55"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitEdit}
                disabled={pending || editBuffer.trim().length === 0}
                className="rounded bg-st-progress px-3 py-1 text-[11.5px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {pending ? "Saving…" : "Save edit"}
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="px-6 py-4 font-mono text-[11.5px] text-fg-subtle">
          {kind}.md — not yet written.
        </div>
      )}
    </section>
  );
}

function ModeToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-[10.5px] font-medium tracking-normal transition-colors ${
        active
          ? "border-line-hover bg-white/[0.04] text-fg-body"
          : "border-line text-fg-mute hover:border-line-hover hover:text-fg-body"
      }`}
      data-testid={`mode-${label.toLowerCase()}`}
    >
      {label}
    </button>
  );
}

function DiffPane({
  diff,
  loading,
  fallback,
}: {
  diff: BrainstormDiff | undefined;
  loading: boolean;
  fallback: string;
}) {
  if (loading || !diff) {
    return (
      <div className="px-6 py-4 font-mono text-[11.5px] text-fg-subtle">
        loading diff…
      </div>
    );
  }
  if (!diff.baseline) {
    // No baseline = nothing to compare against (e.g. the artifact has never
    // been marked ready and no revisions filed). Surface the live body so
    // toggling to Diff isn't a dead end.
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-line bg-bg px-6 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-subtle">
          no diff baseline yet — showing current
        </div>
        <pre className="scroll-hide min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-6 py-3.5 font-mono text-[12px] leading-[1.55] text-fg-body">
          {(diff.current?.body ?? fallback).trim()}
        </pre>
      </div>
    );
  }
  const currentBody = diff.current?.body ?? fallback;
  return <DiffView baseline={diff.baseline.body} current={currentBody} />;
}
