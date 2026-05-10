import { clsx } from "clsx";
import type { TaskStatus } from "@pi-harness/shared";

export type StatusKind =
  | "intake"
  | "progress"
  | "review"
  | "blocked"
  | "shipping"
  | "done";

const KIND_FOR_STATUS: Record<TaskStatus, StatusKind> = {
  backlog: "intake",
  brainstorming: "progress",
  brainstorm_failed: "blocked",
  planning: "progress",
  plan_failed: "blocked",
  executing: "progress",
  code_failed: "blocked",
  verifying: "progress",
  verification_failed: "blocked",
  ready_to_ship: "shipping",
  pr_failed: "blocked",
  done: "done",
  cancelled: "blocked",
};

const COLOR_FOR_KIND: Record<StatusKind, string> = {
  intake: "var(--color-st-idle)",
  progress: "var(--color-st-progress)",
  review: "var(--color-st-review)",
  blocked: "var(--color-st-blocked)",
  shipping: "var(--color-st-shipping)",
  done: "var(--color-st-done)",
};

export function statusKindFor(status: TaskStatus): StatusKind {
  return KIND_FOR_STATUS[status];
}

export function statusColorFor(status: TaskStatus): string {
  return COLOR_FOR_KIND[statusKindFor(status)];
}

const LIVE_KINDS: ReadonlySet<StatusKind> = new Set(["progress"]);

export function StatusIcon({
  kind,
  size = 14,
  live = false,
  className,
}: {
  kind: StatusKind;
  size?: number;
  live?: boolean;
  className?: string;
}) {
  const animated = live && LIVE_KINDS.has(kind);
  const color = COLOR_FOR_KIND[kind];
  return (
    <span
      className={clsx("inline-flex shrink-0 leading-none", animated && "tick-anim", className)}
      style={{ color, width: size, height: size }}
      aria-hidden="true"
    >
      {renderIcon(kind)}
    </span>
  );
}

function renderIcon(kind: StatusKind): React.ReactNode {
  const stroke = "currentColor";
  switch (kind) {
    case "intake":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="2 2.4" />
        </svg>
      );
    case "progress":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M 7 7 L 7 1.5 A 5.5 5.5 0 0 1 12.5 7 Z" fill="currentColor" />
        </svg>
      );
    case "review":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M 7 7 L 7 1.5 A 5.5 5.5 0 0 1 7 12.5 Z" fill="currentColor" />
        </svg>
      );
    case "blocked":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />
          <path d="M 4 7 L 10 7" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "shipping":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%">
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />
          <circle cx="7" cy="7" r="2.2" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg viewBox="0 0 14 14" width="100%" height="100%">
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M 4.2 7.2 L 6.2 9.1 L 9.8 5.2" fill="none" stroke="#0d0e10" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
