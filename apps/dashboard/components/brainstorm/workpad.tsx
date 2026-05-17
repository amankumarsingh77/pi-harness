"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact, TaskStatus } from "@pi-harness/shared";
import { submitArtifactEditAction } from "@/app/tasks/[id]/actions";
import type { BrainstormGate } from "@/lib/api";
import { ApprovalGate } from "./approval-gate";
import { StatusBadge } from "./status-badge";
import type {
  ArtifactEditEvent,
  BrainstormTimeline,
  PendingBatch,
} from "./use-brainstorm-timeline";

type ArtifactTab = "design" | "spec";

export function Workpad({
  taskId,
  taskStatus,
  gate,
  runId,
  design,
  spec,
  timeline,
  onJumpToCommit,
}: {
  readonly taskId: string;
  readonly taskStatus: TaskStatus;
  readonly gate: BrainstormGate;
  readonly runId: string | null;
  readonly design: Artifact | null;
  readonly spec: Artifact | null;
  readonly timeline: BrainstormTimeline;
  readonly onJumpToCommit: (commitSha: string) => void;
}) {
  const [active, setActive] = useState<ArtifactTab>("design");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollByTab = useRef<Record<ArtifactTab, number>>({ design: 0, spec: 0 });
  const artifact = active === "design" ? design : spec;

  const switchTab = (next: ArtifactTab): void => {
    if (scrollRef.current) scrollByTab.current[active] = scrollRef.current.scrollTop;
    setActive(next);
  };

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = scrollByTab.current[active] ?? 0;
  }, [active]);

  return (
    <aside className="brainstorm-workpad" aria-label="Brainstorm workpad">
      <header>
        <div className="workpad-tabs" role="tablist" aria-label="Brainstorm artifacts">
          <TabButton label="DESIGN.MD" active={active === "design"} onClick={() => switchTab("design")} />
          <TabButton label="SPEC.MD" active={active === "spec"} onClick={() => switchTab("spec")} />
        </div>
        <span className="ml-auto">
          {artifact ? <StatusBadge status={artifact.fm.status} /> : "draft"}
        </span>
      </header>
      <div ref={scrollRef} className="workpad-body">
        <WorkpadDocument
          taskId={taskId}
          kind={active}
          artifact={artifact}
          taskStatus={taskStatus}
          pendingBatch={timeline.pendingBatch}
          anchor={timeline.artifactAnchors.get(active) ?? null}
          onJumpToCommit={onJumpToCommit}
        />
      </div>
      <ApprovalGate taskId={taskId} gate={gate} taskStatus={taskStatus} runId={runId} />
    </aside>
  );
}

function WorkpadDocument({
  taskId,
  kind,
  artifact,
  taskStatus,
  pendingBatch,
  anchor,
  onJumpToCommit,
}: {
  readonly taskId: string;
  readonly kind: ArtifactTab;
  readonly artifact: Artifact | null;
  readonly taskStatus: TaskStatus;
  readonly pendingBatch: PendingBatch | null;
  readonly anchor: ArtifactEditEvent | null;
  readonly onJumpToCommit: (commitSha: string) => void;
}) {
  const sections = useMemo(() => parseSections(artifact?.body ?? ""), [artifact?.body]);
  const pendingBySection = useMemo(
    () => pendingQuestionsBySection(pendingBatch, kind),
    [kind, pendingBatch],
  );

  if (!artifact) {
    return <DraftSkeleton kind={kind} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ArtifactEditor taskId={taskId} kind={kind} artifact={artifact} taskStatus={taskStatus} />
      {sections.length === 0 ? (
        <section className="workpad-section">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.body.trim()}</ReactMarkdown>
          {anchor && <AnchorChip anchor={anchor} onJumpToCommit={onJumpToCommit} />}
        </section>
      ) : (
        sections.map((section) => {
          const pending = pendingBySection.get(section.title);
          return (
            <section key={`${kind}:${section.title}`} className="workpad-section">
              <h3>
                {section.title}
                {anchor && <AnchorChip anchor={anchor} onJumpToCommit={onJumpToCommit} />}
                {pending && <span className="pending-chip">pending {pending}</span>}
              </h3>
              {pending ? (
                <PendingSkeleton />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body.trim()}</ReactMarkdown>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function ArtifactEditor({
  taskId,
  kind,
  artifact,
  taskStatus,
}: {
  readonly taskId: string;
  readonly kind: ArtifactTab;
  readonly artifact: Artifact;
  readonly taskStatus: TaskStatus;
}) {
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState(artifact.body);
  const [pending, start] = useTransition();
  const editable = taskStatus === "brainstorming";

  useEffect(() => {
    if (!editing) setBuffer(artifact.body);
  }, [artifact.body, editing]);

  const submit = (): void => {
    if (buffer.trim().length === 0) return;
    if (buffer === artifact.body) {
      setEditing(false);
      return;
    }
    start(async () => {
      await submitArtifactEditAction(taskId, kind, buffer);
      setEditing(false);
    });
  };

  if (!editable) return null;

  return (
    <section className="workpad-edit">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-subtle">
          {kind}.md
        </span>
        <button type="button" onClick={() => setEditing((value) => !value)}>
          {editing ? "Close edit" : "Edit"}
        </button>
      </div>
      {editing && (
        <>
          <textarea
            aria-label={`Edit ${kind} body`}
            value={buffer}
            onChange={(event) => setBuffer(event.target.value)}
            disabled={pending}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" disabled={pending || buffer.trim().length === 0} onClick={submit}>
              {pending ? "Saving" : "Save edit"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function AnchorChip({
  anchor,
  onJumpToCommit,
}: {
  readonly anchor: ArtifactEditEvent;
  readonly onJumpToCommit: (commitSha: string) => void;
}) {
  return (
    <button type="button" className="anchor-chip" onClick={() => onJumpToCommit(anchor.commitSha)}>
      {formatTime(anchor.ts)}
    </button>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} className={active ? "is-active" : ""} onClick={onClick}>
      {label}
    </button>
  );
}

function DraftSkeleton({ kind }: { readonly kind: ArtifactTab }) {
  return (
    <section className="workpad-section">
      <h3>{kind}.md <span className="pending-chip">draft</span></h3>
      <PendingSkeleton />
    </section>
  );
}

function PendingSkeleton() {
  return (
    <div className="workpad-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

type ParsedSection = {
  readonly title: string;
  readonly body: string;
};

function parseSections(body: string): ParsedSection[] {
  const lines = body.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      if (current) sections.push({ title: current.title, body: current.lines.join("\n") });
      current = { title: match[2] ?? "Untitled", lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ title: current.title, body: current.lines.join("\n") });
  return sections;
}

function pendingQuestionsBySection(
  batch: PendingBatch | null,
  kind: ArtifactTab,
): Map<string, string> {
  if (batch === null) return new Map();
  return batch.questions.reduce((map, question) => {
    if (question.sectionTarget.artifact === kind) {
      map.set(question.sectionTarget.section, question.questionId);
    }
    return map;
  }, new Map<string, string>());
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
