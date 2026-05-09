export function VerdictStrip({
  unitPass,
  apiPass,
  visualPass,
  unitTotal,
  apiTotal,
  visualTotal,
  remainingSec,
}: {
  unitPass: number; apiPass: number; visualPass: number;
  unitTotal: number; apiTotal: number; visualTotal: number;
  remainingSec?: number;
}) {
  const greens = (unitPass === unitTotal ? 1 : 0) + (apiPass === apiTotal ? 1 : 0) + (visualPass === visualTotal ? 1 : 0);

  return (
    <section className="m-6 mb-8 flex items-center gap-4.5 rounded-lg border border-cyan-fg/20 bg-[linear-gradient(90deg,rgba(34,211,238,0.06),rgba(167,139,250,0.04))] p-4.5">
      <div className="font-display text-[38px] font-semibold tracking-tighter text-fg">
        {greens}/<em className="not-italic text-cyan-fg2">3</em>
      </div>
      <div className="flex-1">
        <div className="font-display text-base font-semibold tracking-tight text-fg">
          {greens === 3
            ? "All three classes green · PR creation unlocked"
            : `Gate is open · waiting on ${greens === 2 ? "1 evidence class" : `${3 - greens} evidence classes`}`}
        </div>
        <div className="mt-0.5 text-[12.5px] text-fg-subtle">
          unit {unitPass}/{unitTotal} · functional {apiPass}/{apiTotal} · visual {visualPass}/{visualTotal}
          {remainingSec !== undefined && ` · ~${remainingSec}s remaining`}
        </div>
      </div>
    </section>
  );
}
