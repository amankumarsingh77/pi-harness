import { clsx } from "clsx";
import type { Artifact } from "@pi-harness/shared";

// Small textual badge for an artifact's frontmatter status. Color reserved
// for status signal per project aesthetic — no decorative variants.
export function StatusBadge({ status }: { status: Artifact["fm"]["status"] }) {
  const cls = {
    draft: "text-fg-mute",
    ready: "text-st-progress",
    approved: "text-st-done",
  }[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border border-line px-1.5 py-px font-mono text-[10.5px] uppercase tracking-[0.06em]",
        cls,
      )}
    >
      {status}
    </span>
  );
}
