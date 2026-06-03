import { CircleDashed } from "lucide-react";

export function EmptyState({
  title,
  body,
  action,
  icon,
  visual,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly visual?: React.ReactNode;
}) {
  return (
    <section
      role="region"
      aria-label={title}
      className="flex min-h-[170px] flex-col justify-center rounded-lg border border-line bg-card px-5 py-5"
    >
      {visual ?? (
        <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white/[0.03] text-fg-mute">
          {icon ?? <CircleDashed size={16} strokeWidth={1.8} />}
        </div>
      )}
      <h2 className="m-0 text-[15px] font-semibold tracking-[-0.012em] text-fg">{title}</h2>
      <p className="m-0 mt-1.5 max-w-xl text-[12.5px] leading-[1.55] text-fg-mute">{body}</p>
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </section>
  );
}
