export type EvidenceClass = { label: string; passed: number; total: number };

export function VerdictStrip({
  classes,
  remainingSec,
}: {
  // One entry per evidence class present in this run (unit + each scenario type).
  classes: EvidenceClass[];
  remainingSec?: number;
}) {
  const total = classes.length;
  const greens = classes.filter((c) => c.passed === c.total).length;
  const allGreen = total > 0 && greens === total;
  const waiting = total - greens;

  return (
    <section className="m-6 mb-8 flex items-center gap-4.5 rounded-lg border border-cyan-fg/20 bg-[linear-gradient(90deg,rgba(34,211,238,0.06),rgba(167,139,250,0.04))] p-4.5">
      <div className="font-display text-[38px] font-semibold tracking-tighter text-fg">
        {greens}/<em className="not-italic text-cyan-fg2">{total}</em>
      </div>
      <div className="flex-1">
        <div className="font-display text-base font-semibold tracking-tight text-fg">
          {allGreen
            ? `All ${total} evidence ${total === 1 ? "class" : "classes"} green · PR creation unlocked`
            : `Gate is open · waiting on ${waiting} evidence ${waiting === 1 ? "class" : "classes"}`}
        </div>
        <div className="mt-0.5 text-[12.5px] text-fg-subtle">
          {classes.map((c) => `${c.label} ${c.passed}/${c.total}`).join(" · ")}
          {remainingSec !== undefined && ` · ~${remainingSec}s remaining`}
        </div>
      </div>
    </section>
  );
}
