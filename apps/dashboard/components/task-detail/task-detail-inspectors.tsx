"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { AgentEvent } from "@pi-harness/shared";
import type { RunFile } from "@/lib/api";
import { AgentLog } from "./agent-log";

type Inspector = "log" | "changes" | "artifacts";

export type ArtifactSummary = {
  readonly name: string;
  readonly status: string;
  readonly lines: number | null;
  readonly phase: "brainstorm" | "plan" | "verify";
  readonly href: string;
  readonly preview: string;
};

export function TaskDetailInspectors({
  events,
  files,
  artifactSummaries,
  runId,
  live = false,
}: {
  readonly events: readonly AgentEvent[];
  readonly files: readonly RunFile[];
  readonly artifactSummaries: readonly ArtifactSummary[];
  readonly runId: string;
  readonly live?: boolean;
}) {
  const [active, setActive] = useState<Inspector | null>(null);
  const [selectedArtifactName, setSelectedArtifactName] = useState<string | null>(
    artifactSummaries[0]?.name ?? null,
  );
  const selectedArtifact = useMemo(
    () =>
      artifactSummaries.find((artifact) => artifact.name === selectedArtifactName) ??
      artifactSummaries[0] ??
      null,
    [artifactSummaries, selectedArtifactName],
  );

  const openInspector = (next: Inspector): void => {
    if (next === "artifacts" && selectedArtifactName === null) {
      setSelectedArtifactName(artifactSummaries[0]?.name ?? null);
    }
    setActive(next);
  };

  return (
    <>
      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        <InspectorButton onClick={() => openInspector("log")}>Inspect log</InspectorButton>
        <InspectorButton onClick={() => openInspector("changes")}>
          Inspect changes
        </InspectorButton>
        <InspectorButton onClick={() => openInspector("artifacts")}>
          Inspect artifacts
        </InspectorButton>
      </div>

      {active === "log" && (
        <Overlay onClose={() => setActive(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Live log drawer"
            className="absolute top-0 right-0 flex h-full w-[min(620px,100vw)] flex-col border-l border-line-strong bg-[#101217] shadow-[-28px_0_80px_rgba(0,0,0,0.45)]"
          >
            <SurfaceHead title="Live log" onClose={() => setActive(null)}>
              {live && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 font-mono text-[11px] text-st-progress">
                  <span className="pulse-dot" />
                  streaming
                </span>
              )}
            </SurfaceHead>
            <div className="min-h-0 flex-1">
              <AgentLog events={[...events]} runId={runId} live={live} />
            </div>
          </aside>
        </Overlay>
      )}

      {active === "changes" && (
        <Overlay onClose={() => setActive(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Changed files modal"
            className="absolute top-1/2 left-1/2 max-h-[calc(100vh-36px)] w-[min(850px,calc(100vw-36px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-strong bg-[#101217] shadow-[0_34px_90px_rgba(0,0,0,0.56)]"
          >
            <SurfaceHead title="Changed files" onClose={() => setActive(null)}>
              <DeltaPill files={files} />
            </SurfaceHead>
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-left text-fg-subtle">
                    <th className="border-b border-line px-3.5 py-3 font-medium">File</th>
                    <th className="border-b border-line px-3.5 py-3 font-medium">State</th>
                    <th className="border-b border-line px-3.5 py-3 font-medium">Delta</th>
                    <th className="border-b border-line px-3.5 py-3 font-medium">Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {files.length === 0 ? (
                    <tr>
                      <td className="px-3.5 py-4 text-fg-faint" colSpan={4}>
                        No changed files reported for this run.
                      </td>
                    </tr>
                  ) : (
                    files.map((file) => (
                      <tr key={file.path} className="text-fg-body hover:bg-white/[0.022]">
                        <td className="border-b border-line px-3.5 py-3">{file.path}</td>
                        <td className="border-b border-line px-3.5 py-3">{file.state}</td>
                        <td className="border-b border-line px-3.5 py-3">
                          <span className="text-st-done">+{file.added}</span>{" "}
                          <span className="text-st-blocked">-{file.removed}</span>
                        </td>
                        <td className="border-b border-line px-3.5 py-3 text-fg-subtle">
                          read only
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </Overlay>
      )}

      {active === "artifacts" && (
        <Overlay onClose={() => setActive(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Artifacts modal"
            className="absolute top-1/2 left-1/2 max-h-[calc(100vh-36px)] w-[min(850px,calc(100vw-36px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-strong bg-[#101217] shadow-[0_34px_90px_rgba(0,0,0,0.56)]"
          >
            <SurfaceHead title="Artifacts" onClose={() => setActive(null)}>
              {selectedArtifact && (
                <span className="rounded-full border border-line px-2 py-1 font-mono text-[11px] text-fg-mute">
                  {selectedArtifact.name} {selectedArtifact.status}
                </span>
              )}
            </SurfaceHead>
            <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)]">
              <nav
                aria-label="Artifact files"
                className="border-b border-line bg-black/10 p-2.5 md:border-r md:border-b-0"
              >
                {artifactSummaries.length === 0 ? (
                  <p className="px-2 font-mono text-[11px] text-fg-faint">
                    No artifacts reported yet.
                  </p>
                ) : (
                  artifactSummaries.map((artifact) => (
                    <button
                      key={artifact.name}
                      type="button"
                      onClick={() => setSelectedArtifactName(artifact.name)}
                      className="flex min-h-[35px] w-full items-center justify-between rounded-[7px] px-2.5 text-left font-mono text-[11px] text-fg-mute transition-colors hover:bg-white/[0.045] hover:text-fg-body aria-selected:bg-white/[0.045] aria-selected:text-fg-body"
                      aria-selected={artifact.name === selectedArtifact?.name}
                    >
                      <span>{artifact.name}</span>
                      <span>{artifact.lines === null ? "--" : `${artifact.lines}L`}</span>
                    </button>
                  ))
                )}
              </nav>
              <div className="overflow-auto p-5 md:p-6">
                {selectedArtifact ? (
                  <ArtifactPreview artifact={selectedArtifact} />
                ) : (
                  <p className="font-mono text-[11px] text-fg-faint">
                    Artifacts will appear here when the phase writes them.
                  </p>
                )}
              </div>
            </div>
          </section>
        </Overlay>
      )}
    </>
  );
}

function InspectorButton({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center justify-center rounded-[7px] border border-line bg-white/[0.025] px-3 text-[12px] font-medium text-fg-body transition hover:-translate-y-px hover:border-line-hover hover:bg-white/[0.05]"
    >
      {children}
    </button>
  );
}

function Overlay({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-80 bg-black/60 backdrop-blur-[7px]"
      onClick={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>{children}</div>
    </div>
  );
}

function SurfaceHead({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[50px] items-center gap-2.5 border-b border-line px-4">
      <h2 className="m-0 text-[14px] font-semibold text-fg">{title}</h2>
      {children}
      <span className="flex-1" />
      <button
        type="button"
        aria-label="Close inspector"
        onClick={onClose}
        className="h-[30px] w-[30px] rounded-[7px] text-fg-mute transition-colors hover:bg-white/[0.05] hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}

function DeltaPill({ files }: { readonly files: readonly RunFile[] }) {
  const totals = files.reduce(
    (sum, file) => ({
      added: sum.added + file.added,
      removed: sum.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );

  return (
    <span className="rounded-full border border-line px-2 py-1 font-mono text-[11px]">
      <span className="text-st-done">+{totals.added}</span>{" "}
      <span className="text-st-blocked">-{totals.removed}</span>
    </span>
  );
}

function ArtifactPreview({ artifact }: { readonly artifact: ArtifactSummary }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="m-0 text-[18px] font-semibold text-fg">{artifact.name}</h3>
        <Link
          href={artifact.href as Route}
          className="font-mono text-[11px] text-fg-mute transition-colors hover:text-fg"
        >
          open phase
        </Link>
      </div>
      <pre className="m-0 whitespace-pre-wrap rounded-lg border border-line bg-black/15 p-4 font-mono text-[11.5px] leading-relaxed text-fg-body">
        {artifact.preview}
      </pre>
    </div>
  );
}
