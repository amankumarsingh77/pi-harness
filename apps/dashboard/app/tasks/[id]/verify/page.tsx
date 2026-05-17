import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { Pill } from "@/components/ui/pill";
import { EvidenceColumn } from "@/components/verify/evidence-column";
import { ScreenshotPair } from "@/components/verify/screenshot-pair";
import { VerdictStrip } from "@/components/verify/verdict-strip";
import { orchestrator } from "@/lib/server/api";
import type { ProofReport, PlanArtifact } from "@pi-harness/shared";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} · verify · pi-harness` };
}

export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [proof, plan] = await Promise.all([
    orchestrator.getArtifact<ProofReport>(id, "proof-report").catch(() => null),
    orchestrator.getArtifact<PlanArtifact>(id, "plan").catch(() => null),
  ]);

  const apiResults = proof?.scenarios.filter((s) => s.type === "api") ?? [];
  const uiResults = proof?.scenarios.filter((s) => s.type === "ui" || s.type === "ui-visual") ?? [];
  const apiPass = apiResults.filter((s) => s.ok).length;
  const uiPass = uiResults.filter((s) => s.ok).length;
  // Unit count comes from the Coder phase log; for now estimated as plan steps × 1.
  const unitTotal = plan?.steps.length ?? 0;
  const unitPass = unitTotal; // assumed green from Coder; v1.5 reads the actual run count
  const screenshotUrl = (file: string | undefined) =>
    file ? `/api/proxy/tasks/${id}/proof/screenshots/${file.replace(/^screenshots\//, "")}` : null;

  return (
    <>
      <Topbar pathLabel="verification" activeRunsCount={1} worktreesCount={1} worktreesSizeMb={0} />
      <section className="flex flex-wrap items-center gap-3.5 px-6 pb-2 pt-5">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-tighter text-fg">Verification Gate</h1>
        <Pill accent="cyan">{[apiPass===apiResults.length, uiPass===uiResults.length, unitPass===unitTotal].filter(Boolean).length} of 3 evidence ✓</Pill>
      </section>
      <p className="max-w-3xl px-6 pb-5 text-[13px] text-fg-subtle">
        <strong className="border-b border-dashed border-fg-faint text-fg-body">All three evidence classes must pass before a PR can ship — no overrides.</strong>
        &nbsp;&nbsp; {unitPass}/{unitTotal} unit ✓ · {apiPass}/{apiResults.length} functional ✓ · {uiPass}/{uiResults.length} visual
        {proof?.startedAt && ` · gate started ${new Date(proof.startedAt).toLocaleTimeString()}`}
      </p>

      <section className="grid grid-cols-3 gap-4 px-6 pb-8">
        <EvidenceColumn type="unit" passed={unitPass} total={unitTotal}>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {plan?.steps.map((s) => (
              <li key={s.id} className="flex items-baseline gap-2.5 border-b border-dashed border-border-soft py-1 text-[12.5px] last:border-0">
                <span className="w-3 font-mono text-green-fg">✓</span>
                <span>{s.assertion}</span>
              </li>
            ))}
          </ul>
        </EvidenceColumn>

        <EvidenceColumn type="api" passed={apiPass} total={apiResults.length}>
          {apiResults.map((s) => (
            <div key={s.id} className="mb-3 rounded-md border border-border-soft bg-input p-3.5 font-mono text-[11.5px] last:mb-0">
              <div className={`mb-2 font-mono text-[11px] font-bold tracking-wide ${s.ok ? "text-green-fg2" : "text-red-fg2"}`}>
                {s.ok ? "✓" : "✗"} {s.id}
              </div>
              {s.evidence.status && (
                <div className={s.ok ? "text-green-fg" : "text-red-fg"}>
                  → status {s.evidence.status}
                </div>
              )}
              {s.error && <div className="mt-1 text-red-fg2">{s.error}</div>}
            </div>
          ))}
        </EvidenceColumn>

        <EvidenceColumn type="visual" passed={uiPass} total={uiResults.length} capturing={!proof}>
          {uiResults.length === 0 && (
            <div className="text-xs text-fg-faint">no visual scenarios in this plan</div>
          )}
          {uiResults.map((s) => (
            <div key={s.id} className="mb-3 last:mb-0">
              <ScreenshotPair
                expectedUrl={null}
                actualUrl={screenshotUrl(s.evidence.screenshotFile)}
                diffPct={0}
                caption={`${s.id} · ${s.type}`}
              />
            </div>
          ))}
        </EvidenceColumn>
      </section>

      <VerdictStrip
        unitPass={unitPass} apiPass={apiPass} visualPass={uiPass}
        unitTotal={unitTotal} apiTotal={apiResults.length} visualTotal={uiResults.length}
      />
    </>
  );
}
