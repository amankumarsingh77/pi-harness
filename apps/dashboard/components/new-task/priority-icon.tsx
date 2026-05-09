import { clsx } from "clsx";

export type Priority = "none" | "urgent" | "high" | "medium" | "low";

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_ORDER: readonly Priority[] = ["none", "urgent", "high", "medium", "low"];

export function PriorityIcon({ value, className }: { value: Priority; className?: string }) {
  if (value === "none") {
    return (
      <svg viewBox="0 0 14 14" className={clsx("h-3.5 w-3.5 text-fg-mute", className)} aria-hidden="true">
        <rect x="2.5" y="6.25" width="2.2" height="1.5" rx="0.6" fill="currentColor" />
        <rect x="5.9" y="6.25" width="2.2" height="1.5" rx="0.6" fill="currentColor" />
        <rect x="9.3" y="6.25" width="2.2" height="1.5" rx="0.6" fill="currentColor" />
      </svg>
    );
  }
  if (value === "urgent") {
    return (
      <svg viewBox="0 0 14 14" className={clsx("h-3.5 w-3.5 text-st-blocked", className)} aria-hidden="true">
        <rect x="1.5" y="1.5" width="11" height="11" rx="2.4" fill="currentColor" />
        <rect x="6.4" y="3.6" width="1.2" height="4.6" rx="0.6" fill="var(--color-bg)" />
        <rect x="6.4" y="9.2" width="1.2" height="1.4" rx="0.6" fill="var(--color-bg)" />
      </svg>
    );
  }
  const lit = value === "low" ? 1 : value === "medium" ? 2 : 3;
  const bar = (i: number, x: number, y: number, h: number) => (
    <rect
      key={i}
      x={x}
      y={y}
      width="2.4"
      height={h}
      rx="0.6"
      fill={i < lit ? "var(--color-fg-body)" : "var(--color-fg-faint)"}
    />
  );
  return (
    <svg viewBox="0 0 14 14" className={clsx("h-3.5 w-3.5", className)} aria-hidden="true">
      {bar(0, 2, 9, 3)}
      {bar(1, 5.8, 6.5, 5.5)}
      {bar(2, 9.6, 3.5, 8.5)}
    </svg>
  );
}
