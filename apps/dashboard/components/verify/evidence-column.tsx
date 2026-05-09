import { clsx } from "clsx";

const TITLES = {
  unit:     "UNIT + INTEGRATION",
  api:      "FUNCTIONAL · API",
  visual:   "VISUAL · PLAYWRIGHT",
} as const;

export function EvidenceColumn({
  type,
  passed,
  total,
  capturing = false,
  children,
}: {
  type: keyof typeof TITLES;
  passed: number;
  total: number;
  capturing?: boolean;
  children: React.ReactNode;
}) {
  const allGreen = passed === total;
  const accent = allGreen ? "green" : capturing ? "amber" : "red";

  return (
    <article className={clsx("flex flex-col overflow-hidden rounded-lg border border-border-soft bg-card",
                             accent === "green" && "[&>header]:bg-[linear-gradient(180deg,rgba(52,211,153,0.08),transparent)]",
                             accent === "amber" && "[&>header]:bg-[linear-gradient(180deg,rgba(251,191,36,0.07),transparent)]")}>
      <header className="flex items-center gap-2.5 border-b px-4.5 pb-2.5 pt-3.5"
              style={{ borderColor: accent === "green" ? "rgba(52,211,153,0.18)" : "rgba(251,191,36,0.2)" }}>
        <span className={clsx("inline-flex h-5 w-5 items-center justify-center rounded font-mono text-xs font-bold",
                              accent === "green" && "bg-green-fg/[0.12] text-green-fg2",
                              accent === "amber" && "bg-amber-fg/[0.12] text-amber-fg2")}>
          {capturing ? "⏳" : allGreen ? "✓" : "✗"}
        </span>
        <h2 className={clsx("m-0 font-mono text-[11px] font-bold tracking-[0.14em]",
                            accent === "green" ? "text-green-fg" : "text-amber-fg")}>
          {TITLES[type]}
        </h2>
        <span className={clsx("ml-auto font-mono text-xs font-semibold",
                              accent === "green" ? "text-green-fg2" : "text-amber-fg2")}>
          {capturing ? "capturing…" : `${passed} / ${total}`}
        </span>
      </header>
      <div className="flex-1 px-4.5 py-4">{children}</div>
    </article>
  );
}
