"use client";

import { useEffect, useState } from "react";
import type { Artifact } from "@pi-harness/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StatusIcon } from "@/components/kanban/status-icon";

type ArtifactKind = "plan" | "scenarios";
type ArtifactTab = "rendered" | "raw" | "diff";

export function PlanArtifactConsole({
  plan,
  scenarios,
}: {
  readonly plan: Artifact | null;
  readonly scenarios: Artifact | null;
}) {
  const [expanded, setExpanded] = useState<ArtifactKind | null>(null);
  const [tab, setTab] = useState<ArtifactTab>("rendered");
  const expandedArtifact = expanded === "plan" ? plan : expanded === "scenarios" ? scenarios : null;

  useEffect(() => {
    if (expanded === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <>
      <section
        className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]"
        aria-label="Main artifacts"
      >
        <ArtifactPane
          kind="plan"
          title="plan.md"
          artifact={plan}
          onExpand={() => {
            setExpanded("plan");
            setTab("rendered");
          }}
        />
        <ArtifactPane
          kind="scenarios"
          title="scenarios.yaml"
          artifact={scenarios}
          onExpand={() => {
            setExpanded("scenarios");
            setTab("rendered");
          }}
        />
      </section>

      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[4px]"
          onClick={() => setExpanded(null)}
        >
          <section
            className="absolute left-1/2 top-1/2 max-h-[min(82vh,760px)] w-[min(980px,calc(100vw-34px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[12px] border border-line-strong bg-card shadow-[0_24px_90px_rgba(0,0,0,0.56)]"
            role="dialog"
            aria-modal="true"
            aria-label={`${expanded === "plan" ? "plan.md" : "scenarios.yaml"} expanded artifact`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-center gap-3 border-b border-line px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-fg">
                  {expanded === "plan" ? "plan.md" : "scenarios.yaml"}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-fg-mute">
                  expanded artifact · rendered / raw / diff
                </div>
              </div>
              <button
                type="button"
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-fg-mute transition hover:bg-card-hover hover:text-fg"
                aria-label="Close artifact modal"
                onClick={() => setExpanded(null)}
              >
                ×
              </button>
            </header>

            <div className="grid min-h-[520px] grid-cols-1 md:grid-cols-[230px_minmax(0,1fr)]">
              <nav className="scroll-hide flex gap-1 overflow-x-auto border-b border-line p-3 md:block md:border-b-0 md:border-r">
                <ArtifactTabButton active={tab === "rendered"} onClick={() => setTab("rendered")}>
                  Rendered
                </ArtifactTabButton>
                <ArtifactTabButton active={tab === "raw"} onClick={() => setTab("raw")}>
                  Raw source
                </ArtifactTabButton>
                <ArtifactTabButton active={tab === "diff"} onClick={() => setTab("diff")}>
                  Diff from previous
                </ArtifactTabButton>
              </nav>
              <div className="scroll-hide max-h-[620px] overflow-y-auto px-5 py-4">
                <ArtifactModalBody artifact={expandedArtifact} kind={expanded} tab={tab} />
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ArtifactPane({
  kind,
  title,
  artifact,
  onExpand,
}: {
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly artifact: Artifact | null;
  readonly onExpand: () => void;
}) {
  return (
    <article className="min-h-[330px] overflow-hidden rounded-[9px] border border-line bg-card">
      <header className="flex items-center gap-2.5 border-b border-line px-3 py-3">
        <StatusIcon kind={artifact ? "review" : "intake"} size={14} />
        <span className="font-mono text-[12px] font-semibold text-fg">{title}</span>
        <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
          status: {artifact?.fm.status ?? "missing"}
        </span>
        <button
          type="button"
          className="min-h-[26px] rounded-[7px] border border-line bg-white/[0.02] px-2 font-mono text-[10.5px] text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/[0.045]"
          onClick={onExpand}
        >
          Expand
        </button>
      </header>
      <div className="scroll-hide h-[282px] overflow-y-auto px-4 py-3.5">
        <ArtifactPreview artifact={artifact} kind={kind} />
      </div>
    </article>
  );
}

function ArtifactPreview({
  artifact,
  kind,
}: {
  readonly artifact: Artifact | null;
  readonly kind: ArtifactKind;
}) {
  if (!artifact) {
    return (
      <p className="font-mono text-[12px] italic text-fg-mute">
        {kind === "plan"
          ? "plan.md has not been authored yet"
          : "scenarios.yaml has not been authored yet"}
      </p>
    );
  }

  if (kind === "scenarios") {
    return <pre className="whitespace-pre font-mono text-[11.5px] leading-[1.58] text-fg-body">{artifact.body.trim()}</pre>;
  }

  return (
    <div className="markdown-body text-[13.5px] leading-[1.65] text-fg-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.body.trim()}</ReactMarkdown>
    </div>
  );
}

function ArtifactModalBody({
  artifact,
  kind,
  tab,
}: {
  readonly artifact: Artifact | null;
  readonly kind: ArtifactKind;
  readonly tab: ArtifactTab;
}) {
  if (!artifact) {
    return (
      <p className="font-mono text-[12px] italic text-fg-mute">
        This artifact has not been authored yet.
      </p>
    );
  }

  if (tab === "diff") {
    return (
      <p className="rounded border border-line bg-bg p-3 font-mono text-[12px] text-fg-mute">
        No previous artifact diff is available from the current plan bundle.
      </p>
    );
  }

  if (tab === "raw" || kind === "scenarios") {
    return (
      <pre className="overflow-x-auto whitespace-pre rounded border border-line bg-bg p-3 font-mono text-[12px] leading-[1.58] text-fg-body">
        {artifact.body.trim()}
      </pre>
    );
  }

  return (
    <div className="markdown-body text-[13.5px] leading-[1.65] text-fg-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.body.trim()}</ReactMarkdown>
    </div>
  );
}

function ArtifactTabButton({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={[
        "w-full whitespace-nowrap rounded-[7px] border px-2.5 py-2 text-left font-mono text-[11px] md:mb-1",
        active
          ? "border-line bg-white/[0.025] text-fg-body"
          : "border-transparent text-fg-mute hover:border-line hover:bg-white/[0.018] hover:text-fg-body",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
