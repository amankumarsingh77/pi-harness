// Inline pill rendering a single `file:line` evidence citation. Visual-only,
// no link behaviour yet (the dashboard doesn't have a code viewer in this
// slice).
export function EvidencePill({ citation }: { citation: string }) {
  return (
    <code className="inline-flex items-center rounded border border-line bg-white/[0.03] px-1.5 py-px font-mono text-[10.5px] text-fg-mute">
      {citation}
    </code>
  );
}
