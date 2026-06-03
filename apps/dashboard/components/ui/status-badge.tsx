import { clsx } from "clsx";

export type StatusBadgeTone =
  | "neutral"
  | "progress"
  | "review"
  | "blocked"
  | "done";

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  neutral: "border-line bg-white/[0.02] text-fg-mute",
  progress: "border-st-progress/35 bg-st-progress/[0.08] text-st-progress",
  review: "border-st-review/35 bg-st-review/[0.08] text-st-review",
  blocked: "border-st-blocked/35 bg-st-blocked/[0.08] text-st-blocked",
  done: "border-st-done/35 bg-st-done/[0.08] text-st-done",
};

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  readonly tone?: StatusBadgeTone;
  readonly children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-[24px] items-center gap-1.5 rounded-full border px-2.5 font-mono text-[11px] font-medium leading-none",
        TONE_CLASS[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />
      {children}
    </span>
  );
}
