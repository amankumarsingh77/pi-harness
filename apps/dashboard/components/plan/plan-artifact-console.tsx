"use client";

import { useState } from "react";
import type { Artifact } from "@pi-harness/shared";
import { ArtifactMarkdown } from "@/components/artifact-markdown";
import { StatusIcon } from "@/components/kanban/status-icon";
import { ExecutionPhasesPreview } from "./execution-phases-preview";

type ArtifactTab = "plan" | "phasePlans" | "executionDag" | "scenarios" | "blastRadius" | "raw";

const ARTIFACT_TABS: readonly { readonly id: ArtifactTab; readonly label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "phasePlans", label: "Phase Plans" },
  { id: "executionDag", label: "Execution DAG" },
  { id: "scenarios", label: "Scenarios" },
  { id: "blastRadius", label: "Blast Radius" },
  { id: "raw", label: "Raw" },
];

export function PlanArtifactConsole({
  plan,
  phasePlans,
  blastRadius,
  scenarios,
  executionDag,
}: {
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly blastRadius: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly executionDag: Artifact | null;
}) {
  const [activeTab, setActiveTab] = useState<ArtifactTab>("plan");

  return (
    <section
      className="min-w-0 overflow-hidden rounded-[9px] border border-line bg-card"
      aria-label="Main artifacts"
    >
      <header className="border-b border-line px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">Plan review</span>
          <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
            {artifactSummary({ plan, phasePlans, scenarios, blastRadius, executionDag })}
          </span>
        </div>
        <div
          className="scroll-hide mt-3 flex gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Plan artifact tabs"
        >
          {ARTIFACT_TABS.map((tab) => (
            <ArtifactTabButton
              key={tab.id}
              label={tab.label}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </div>
      </header>
      <div className="scroll-hide max-h-[calc(100vh-260px)] min-h-[560px] overflow-y-auto px-4 py-4">
        <ArtifactTabBody
          tab={activeTab}
          plan={plan}
          phasePlans={phasePlans}
          blastRadius={blastRadius}
          scenarios={scenarios}
          executionDag={executionDag}
        />
      </div>
    </section>
  );
}

function ArtifactTabButton({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={[
        "shrink-0 rounded-[7px] border px-2.5 py-1.5 text-[11.5px] transition",
        active
          ? "border-line-strong bg-white/[0.045] text-fg"
          : "border-line bg-transparent text-fg-mute hover:border-line-hover hover:text-fg-body",
      ].join(" ")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ArtifactTabBody({
  tab,
  plan,
  phasePlans,
  blastRadius,
  scenarios,
  executionDag,
}: {
  readonly tab: ArtifactTab;
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly blastRadius: Artifact | null;
  readonly scenarios: Artifact | null;
  readonly executionDag: Artifact | null;
}) {
  if (tab === "plan") return <PlanTab artifact={plan} />;
  if (tab === "phasePlans") return <PhasePlansTab phasePlans={phasePlans} />;
  if (tab === "executionDag") {
    return <ExecutionPhasesPreview artifact={executionDag} />;
  }
  if (tab === "scenarios") return <YamlTab title="scenarios.yaml" artifact={scenarios} />;
  if (tab === "blastRadius") return <YamlTab title="blast-radius.yaml" artifact={blastRadius} />;
  return (
    <RawArtifacts
      artifacts={[
        rawArtifact("plan.md", plan),
        ...phasePlans.map((artifact) => rawArtifact(`plan-${artifact.fm.phase ?? "?"}.md`, artifact)),
        rawArtifact("execution-dag.yaml", executionDag),
        rawArtifact("scenarios.yaml", scenarios),
        rawArtifact("blast-radius.yaml", blastRadius),
      ]}
    />
  );
}

function PlanTab({ artifact }: { readonly artifact: Artifact | null }) {
  if (!artifact) return <EmptyArtifact title="plan.md" />;
  return (
    <article aria-label="plan.md rendered artifact">
      <ArtifactHeader filename="plan.md" status={artifact.fm.status} />
      <ArtifactMarkdown>{artifact.body}</ArtifactMarkdown>
    </article>
  );
}

function PhasePlansTab({ phasePlans }: { readonly phasePlans: readonly Artifact[] }) {
  if (phasePlans.length === 0) {
    return (
      <p className="m-0 rounded-[7px] border border-dashed border-line px-3 py-3 font-mono text-[11.5px] text-fg-mute">
        phase-level plan docs not authored yet
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      {phasePlans.map((artifact) => (
        <article
          key={artifact.fm.phase ?? artifact.body}
          className="rounded-[8px] border border-line bg-white/[0.014] px-4 py-3"
        >
          <ArtifactHeader
            filename={`plan-${artifact.fm.phase ?? "?"}.md`}
            status={artifact.fm.status}
            title={`Phase ${artifact.fm.phase ?? "?"}`}
          />
          <ArtifactMarkdown>{artifact.body}</ArtifactMarkdown>
        </article>
      ))}
    </div>
  );
}

function YamlTab({
  title,
  artifact,
}: {
  readonly title: string;
  readonly artifact: Artifact | null;
}) {
  if (!artifact) return <EmptyArtifact title={title} />;
  return (
    <article>
      <ArtifactHeader filename={title} status={artifact.fm.status} />
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-[7px] border border-line bg-bg p-3 font-mono text-[12px] leading-[1.58] text-fg-body">
        {artifact.body.trim()}
      </pre>
    </article>
  );
}

function RawArtifacts({
  artifacts,
}: {
  readonly artifacts: readonly { readonly filename: string; readonly artifact: Artifact | null }[];
}) {
  return (
    <div className="grid gap-3">
      {artifacts.map((item) => (
        <section key={item.filename} className="min-w-0 overflow-hidden rounded-[8px] border border-line bg-white/[0.012]">
          <header className="flex min-w-0 items-center gap-2 border-b border-line px-3 py-2">
            <StatusIcon kind={item.artifact ? "review" : "intake"} size={13} />
            <span className="min-w-0 truncate font-mono text-[11.5px] font-semibold text-fg-body">{item.filename}</span>
            <span className="ml-auto font-mono text-[10.5px] text-fg-mute">
              {item.artifact?.fm.status ?? "missing"}
            </span>
          </header>
          <pre className="max-h-[260px] max-w-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-[1.55] text-fg-body">
            {item.artifact?.body.trim() ?? `${item.filename} has not been authored yet`}
          </pre>
        </section>
      ))}
    </div>
  );
}

function ArtifactHeader({
  filename,
  status,
  title,
}: {
  readonly filename: string;
  readonly status: string;
  readonly title?: string;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-2">
      <StatusIcon kind="review" size={14} />
      <span className="text-[13px] font-semibold text-fg">{title ?? filename}</span>
      {title && <span className="font-mono text-[10.5px] text-fg-mute">{filename}</span>}
      <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-fg-mute">
        {status}
      </span>
    </header>
  );
}

function EmptyArtifact({ title }: { readonly title: string }) {
  return (
    <p className="m-0 rounded-[7px] border border-dashed border-line px-3 py-3 font-mono text-[11.5px] italic text-fg-mute">
      {title} has not been authored yet
    </p>
  );
}

function rawArtifact(filename: string, artifact: Artifact | null): { readonly filename: string; readonly artifact: Artifact | null } {
  return { filename, artifact };
}

function artifactSummary({
  plan,
  phasePlans,
  scenarios,
  blastRadius,
  executionDag,
}: {
  readonly plan: Artifact | null;
  readonly phasePlans: readonly Artifact[];
  readonly scenarios: Artifact | null;
  readonly blastRadius: Artifact | null;
  readonly executionDag: Artifact | null;
}): string {
  const ready = [plan, scenarios, blastRadius, executionDag, ...phasePlans].filter(isReady).length;
  const total = 4 + phasePlans.length;
  return `${ready}/${total} artifacts ready`;
}

function isReady(artifact: Artifact | null): boolean {
  return artifact?.fm.status === "ready" || artifact?.fm.status === "human_edited" || artifact?.fm.status === "approved";
}
