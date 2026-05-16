"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  selectBrainstormMockAction,
  submitBrainstormMockEditAction,
} from "@/app/tasks/[id]/actions";
import { GridDrawerPreview } from "./mock-miniature/grid-drawer-preview";
import { RowsPreview } from "./mock-miniature/rows-preview";
import type { TimelineMock } from "./use-brainstorm-timeline";

export function MockStrip({
  taskId,
  mocks,
  onFocusComposer,
}: {
  readonly taskId: string;
  readonly mocks: ReadonlyArray<TimelineMock>;
  readonly onFocusComposer: () => void;
}) {
  const [pendingMockId, setPendingMockId] = useState<string | null>(null);
  if (mocks.length === 0) return null;

  return (
    <section className="brainstorm-mock-section" aria-label="Mock proposals">
      <div className="brainstorm-mock-head">
        <h2>Mock proposals</h2>
        <span>{mocks.length} direction{mocks.length === 1 ? "" : "s"}</span>
      </div>
      <div className="brainstorm-mock-strip" tabIndex={0}>
        {mocks.map((entry) => (
          <MockCard
            key={entry.mock.mockId}
            taskId={taskId}
            entry={entry}
            actionLocked={pendingMockId !== null}
            onPendingChange={setPendingMockId}
          />
        ))}
        <button
          type="button"
          className="brainstorm-mock-card brainstorm-mock-add-card"
          onClick={onFocusComposer}
        >
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-subtle">
            another direction
          </span>
          <span className="text-left text-[13px] text-fg-body">
            Nudge the agent for a sharper alternative.
          </span>
          <span className="mt-auto font-mono text-[11px] text-st-progress">Focus composer</span>
        </button>
      </div>
    </section>
  );
}

function MockCard({
  taskId,
  entry,
  actionLocked,
  onPendingChange,
}: {
  readonly taskId: string;
  readonly entry: TimelineMock;
  readonly actionLocked: boolean;
  readonly onPendingChange: (mockId: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const canEdit = !entry.locked && !actionLocked && !pending;
  const canChoose = !entry.locked && !entry.selected && !actionLocked && !pending;
  const canSubmitEdit = canEdit && comment.trim().length > 0;

  const submitEdit = (): void => {
    if (!canSubmitEdit) return;
    const next = comment.trim();
    onPendingChange(entry.mock.mockId);
    start(async () => {
      try {
        await submitBrainstormMockEditAction(taskId, entry.mock.mockId, next);
        setComment("");
        setEditing(false);
      } finally {
        onPendingChange(null);
      }
    });
  };

  const choose = (): void => {
    if (!canChoose) return;
    onPendingChange(entry.mock.mockId);
    start(async () => {
      try {
        await selectBrainstormMockAction(taskId, entry.mock.mockId);
      } finally {
        onPendingChange(null);
      }
    });
  };

  return (
    <article
      className={`brainstorm-mock-card ${entry.mock.recommended ? "is-recommended" : ""} ${
        entry.selected ? "is-chosen" : ""
      } ${entry.dimmed ? "is-dimmed" : ""}`}
      data-testid="brainstorm-mock-card"
    >
      <div className="brainstorm-mock-thumb">
        <Miniature entry={entry} />
      </div>
      <div className="brainstorm-mock-body">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-[13.5px] font-semibold text-fg">{entry.mock.title}</h3>
          {entry.mock.recommended && <span className="mock-tag progress">recommended</span>}
          {entry.selected && <span className="mock-tag done">chosen</span>}
        </div>
        <p className="line-clamp-2 text-[12.5px] leading-[1.45] text-fg-mute">
          {entry.mock.summary}
        </p>
        <div className="brainstorm-page-chips">
          {entry.mock.pages.map((page) => (
            <span key={page.pageId}>{page.title}</span>
          ))}
        </div>
      </div>
      {editing && (
        <div className="border-t border-line px-3 py-2">
          <textarea
            aria-label="Mock edit request"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={pending}
            placeholder="Describe the mock change..."
            className="min-h-14 w-full resize-none border-0 bg-transparent p-0 text-[12.5px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
      )}
      <div className="brainstorm-mock-actions">
        <Link
          href={`/tasks/${taskId}/brainstorm/mocks/${entry.mock.mockId}` as never}
          aria-label={`Open mock ${entry.mock.title}`}
          className="mock-action"
        >
          Open
        </Link>
        <button
          type="button"
          aria-label={`Edit mock ${entry.mock.title}`}
          disabled={!canEdit}
          onClick={() => setEditing((value) => !value)}
          className="mock-action"
        >
          Edit
        </button>
        {editing ? (
          <button
            type="button"
            disabled={!canSubmitEdit}
            onClick={submitEdit}
            className="mock-action primary"
          >
            {pending ? "Submitting" : "Submit"}
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Choose mock ${entry.mock.title}`}
            disabled={!canChoose}
            onClick={choose}
            className="mock-action primary"
          >
            {entry.selected ? "Chosen" : "Choose"}
          </button>
        )}
      </div>
    </article>
  );
}

function Miniature({ entry }: { readonly entry: TimelineMock }) {
  const miniature = entry.mock.miniature;
  if (miniature?.kind === "rows") return <RowsPreview miniature={miniature} />;
  if (miniature?.kind === "grid+drawer") return <GridDrawerPreview miniature={miniature} />;
  return (
    <div className="mini-fallback">
      <span>{entry.mock.pages.length} page{entry.mock.pages.length === 1 ? "" : "s"}</span>
      <strong>no preview</strong>
    </div>
  );
}
