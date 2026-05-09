import { clsx } from "clsx";

export type Accent = "violet" | "blue" | "amber" | "cyan" | "red" | "green" | "neutral";

const ACCENT_CLASS: Record<Accent, string> = {
  violet:  "bg-violet-bg text-[#c4b5fd]",
  blue:    "bg-blue-bg text-[#93c5fd]",
  amber:   "bg-amber-bg text-amber-fg2",
  cyan:    "bg-cyan-bg text-cyan-fg2",
  red:     "bg-red-bg text-red-fg2",
  green:   "bg-green-bg text-green-fg2",
  neutral: "bg-sub text-fg-label border border-border",
};

export function Pill({
  accent,
  live = false,
  children,
}: {
  accent: Accent;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
        ACCENT_CLASS[accent],
      )}
    >
      {live && <span className="pulse-dot" />}
      {children}
    </span>
  );
}
