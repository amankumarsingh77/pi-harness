import "./brainstorm.css";

export default function BrainstormLoading() {
  return (
    <section className="brainstorm-shell">
      <div className="brainstorm-page-header">
        <div className="h-3 w-40 rounded bg-white/[0.04]" />
        <div className="mt-4 h-5 w-2/3 rounded bg-white/[0.04]" />
      </div>
      <div className="brainstorm-grid">
        <SkeletonColumn label="rail" />
        <SkeletonColumn label="focus" />
        <SkeletonColumn label="workpad" />
      </div>
    </section>
  );
}

function SkeletonColumn({ label }: { readonly label: string }) {
  return (
    <div className="min-h-0 border-r border-line p-4 last:border-r-0">
      <div className="mb-5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-subtle">
        {label}
      </div>
      <div className="workpad-skeleton">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
