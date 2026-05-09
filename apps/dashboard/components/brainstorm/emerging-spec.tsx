import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Artifact } from "@pi-harness/shared";
import { StatusBadge } from "./status-badge";

// Two stacked artifact panes (design.md, spec.md). The outer container
// splits its height evenly; each block has its own independent scroll body
// so a long design can't push the spec out of view.
export function ArtifactPane({
  design,
  spec,
}: {
  design: Artifact | null;
  spec: Artifact | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ArtifactBlock title="design.md" artifact={design} />
      <ArtifactBlock title="spec.md" artifact={spec} />
    </div>
  );
}

function ArtifactBlock({ title, artifact }: { title: string; artifact: Artifact | null }) {
  return (
    <section className="flex min-h-0 flex-1 basis-0 flex-col border-b border-line last:border-0">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-subtle">
        <span>{title}</span>
        {artifact && <StatusBadge status={artifact.fm.status} />}
        {artifact && (
          <span className="ml-auto text-[10.5px] text-fg-faint normal-case tracking-normal">
            updated {new Date(artifact.fm.last_updated).toLocaleTimeString([], { hour12: false })}
            {artifact.fm.last_updated_by && <> · {artifact.fm.last_updated_by}</>}
          </span>
        )}
      </header>
      {artifact ? (
        <div className="scroll-hide markdown-body min-h-0 flex-1 overflow-y-auto px-6 py-3.5 text-[13px] leading-[1.65] text-fg-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.body.trim()}</ReactMarkdown>
        </div>
      ) : (
        <div className="px-6 py-4 font-mono text-[11.5px] text-fg-subtle">
          {title} — not yet written.
        </div>
      )}
    </section>
  );
}

export { ArtifactPane as EmergingSpec };
