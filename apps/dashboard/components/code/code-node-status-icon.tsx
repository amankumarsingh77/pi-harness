import { clsx } from "clsx";
import type { NodeStatus } from "@/lib/code/derive-code-state";

// Node-status icon for the code page. Distinct from kanban's StatusIcon (which
// maps a task's visualKind) — code DAG nodes have their own status enum. Reuses
// the same --color-st-* tokens and SVG idioms for visual consistency.

const COLOR_FOR_STATUS: Record<NodeStatus, string> = {
  pending: "var(--color-fg-ghost)",
  running: "var(--color-st-progress)",
  succeeded: "var(--color-st-done)",
  failed: "var(--color-st-blocked)",
  blocked: "var(--color-fg-subtle)",
};

const LABEL_FOR_STATUS: Record<NodeStatus, string> = {
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  blocked: "blocked",
};

export function CodeNodeStatusIcon({
  status,
  size = 14,
  className,
}: {
  readonly status: NodeStatus;
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={LABEL_FOR_STATUS[status]}
      className={clsx("inline-flex shrink-0 leading-none", className)}
      style={{ color: COLOR_FOR_STATUS[status], width: size, height: size }}
    >
      {renderIcon(status)}
    </span>
  );
}

function renderIcon(status: NodeStatus): React.ReactNode {
  switch (status) {
    case "succeeded":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M4.3 7.1 L6.2 9 L9.7 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "running":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
          <path d="M7 1 A6 6 0 0 1 13 7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 7 7"
              to="360 7 7"
              dur="0.9s"
              repeatCount="indefinite"
            />
          </path>
        </svg>
      );
    case "failed":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5 L9 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "blocked":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%" aria-hidden="true">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.4 7 H9.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      );
    case "pending":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%" aria-hidden="true">
          <circle
            cx="7"
            cy="7"
            r="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="2 2"
          />
        </svg>
      );
  }
}
