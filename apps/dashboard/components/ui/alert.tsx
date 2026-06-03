import { AlertTriangle, Info } from "lucide-react";
import { clsx } from "clsx";

export type AlertTone = "danger" | "info";

const TONE_CLASS: Record<AlertTone, string> = {
  danger: "border-st-blocked/40 bg-st-blocked/[0.07] text-st-blocked",
  info: "border-st-progress/35 bg-st-progress/[0.07] text-st-progress",
};

export function Alert({
  tone = "info",
  title,
  label,
  action,
  children,
}: {
  readonly tone?: AlertTone;
  readonly title: string;
  readonly label?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  const Icon = tone === "danger" ? AlertTriangle : Info;
  return (
    <section
      role="alert"
      aria-label={label}
      className={clsx("flex items-start gap-3 rounded-lg border px-4 py-3", TONE_CLASS[tone])}
    >
      <Icon className="mt-0.5 shrink-0" size={16} strokeWidth={1.8} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-current">
          {title}
        </h2>
        <div className="mt-1 text-[12.5px] leading-[1.55] text-fg-body">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}
