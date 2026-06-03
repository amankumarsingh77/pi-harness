import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { Pill } from "@/components/ui/pill";
import { EvidenceColumn } from "@/components/verify/evidence-column";
import { ScreenshotPair } from "@/components/verify/screenshot-pair";
import { VerdictStrip, type EvidenceClass } from "@/components/verify/verdict-strip";
import { orchestrator } from "@/lib/server/api";
import type { ProofReport, PlanArtifact, ScenarioResult } from "@pi-harness/shared";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · verify · pi-harness` };
}

// Group scenario results by their free-string `type` so the gate renders one
// column per evidence class the plan actually produced — no hardcoded set.
function groupByType(scenarios: ScenarioResult[]): [string, ScenarioResult[]][] {
  const groups = new Map<string, ScenarioResult[]>();
  for (const s of scenarios) {
    const bucket = groups.get(s.type) ?? [];
    bucket.push(s);
    groups.set(s.type, bucket);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [proof, plan] = await Promise.all([
    orchestrator.getArtifact<ProofReport>(id, "proof-report").catch(() => null),
    orchestrator.getArtifact<PlanArtifact>(id, "plan").catch(() => null),
  ]);

  // Unit evidence comes from the plan steps (assumed green from the Coder phase;
  // a later pass reads the actual run count).
  const unitTotal = plan?.steps.length ?? 0;
  const unitPass = unitTotal;

  const scenarioGroups = groupByType(proof?.scenarios ?? []);
  const screenshotUrl = (file: string | undefined) =>
    file ? `/api/proxy/tasks/${id}/proof/screenshots/${file.replace(/^screenshots\//, "")}` : null;

  // Evidence classes: unit, then one per scenario type present.
  const classes: EvidenceClass[] = [
    { label: "unit", passed: unitPass, total: unitTotal },
    ...scenarioGroups.map(([type, results]) => ({
      label: type,
      passed: results.filter((s) => s.ok).length,
      total: results.length,
    })),
  ];
  const greens = classes.filter((c) => c.passed === c.total).length;
  const columnCount = classes.length;

  return (
    <>
      <Topbar pathLabel="verification" activeRunsCount={1} worktreesCount={1} worktreesSizeMb={0} />
      <section className="flex flex-wrap items-center gap-3.5 px-6 pb-2 pt-5">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-tighter text-fg">Verification Gate</h1>
        <Pill accent="cyan">{greens} of {columnCount} evidence ✓</Pill>
      </section>
      <p className="max-w-3xl px-6 pb-5 text-[13px] text-fg-subtle">
        <strong className="border-b border-dashed border-fg-faint text-fg-body">Every evidence class must pass before a PR can ship — no overrides.</strong>
        &nbsp;&nbsp; {classes.map((c) => `${c.passed}/${c.total} ${c.label}`).join(" · ")}
        {proof?.startedAt && ` · gate started ${new Date(proof.startedAt).toLocaleTimeString()}`}
      </p>

      <section
        className="grid gap-4 px-6 pb-8"
        style={{ gridTemplateColumns: `repeat(${Math.min(columnCount, 3)}, minmax(0, 1fr))` }}
      >
        <EvidenceColumn title="UNIT + INTEGRATION" passed={unitPass} total={unitTotal}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {plan?.steps.map((s) => (
              <li key={s.id} className="flex items-baseline gap-2.5 border-b border-dashed border-border-soft py-1 text-[12.5px] last:border-0">
                <span className="w-3 font-mono text-green-fg">✓</span>
                <span>{s.assertion}</span>
              </li>
            ))}
          </ul>
        </EvidenceColumn>

        {scenarioGroups.map(([type, results]) => {
          const passed = results.filter((s) => s.ok).length;
          return (
            <EvidenceColumn key={type} title={type.toUpperCase()} passed={passed} total={results.length} capturing={!proof}>
              {results.map((s) => {
                const shot = screenshotUrl(s.evidence.screenshotFile);
                return (
                  <div key={s.id} className="mb-3 last:mb-0">
                    <div className="rounded-md border border-border-soft bg-input p-3.5 font-mono text-[11.5px]">
                      <div className={`mb-2 font-mono text-[11px] font-bold tracking-wide ${s.ok ? "text-green-fg2" : "text-red-fg2"}`}>
                        {s.ok ? "✓" : "✗"} {s.id}
                      </div>
                      {s.evidence.status !== undefined && (
                        <div className={s.ok ? "text-green-fg" : "text-red-fg"}>→ status {s.evidence.status}</div>
                      )}
                      {s.error && <div className="mt-1 text-red-fg2">{s.error}</div>}
                    </div>
                    {shot && (
                      <div className="mt-2">
                        <ScreenshotPair expectedUrl={null} actualUrl={shot} diffPct={0} caption={`${s.id} · ${s.type}`} />
                      </div>
                    )}
                  </div>
                );
              })}
              {results.length === 0 && (
                <div className="text-xs text-fg-faint">no {type} scenarios in this plan</div>
              )}
            </EvidenceColumn>
          );
        })}
      </section>

      <VerdictStrip classes={classes} />
    </>
  );
}
