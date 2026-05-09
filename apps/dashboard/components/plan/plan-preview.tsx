import { clsx } from "clsx";
import type { MockPlan, MockPlanFileChange, MockPlanRisk } from "@/types/mocks";
import { InlineMd } from "./inline-md";

export function PlanPreview({ plan }: { plan: MockPlan }) {
  return (
    <article className="max-w-[720px] px-7 py-5.5 pb-7">
      <Section num="01" title="Approach">
        {plan.approachParagraphs.map((p, i) => (
          <p
            key={i}
            className="mb-3 text-[13.5px] leading-[1.65] tracking-[-0.005em] text-fg-body last:mb-0"
          >
            <InlineMd text={p} />
          </p>
        ))}
      </Section>

      <Section num="02" title="File changes">
        <div className="mb-2 flex flex-col overflow-hidden rounded-md border border-line">
          {plan.fileChanges.map((f) => (
            <FileRow key={f.path} file={f} />
          ))}
        </div>
      </Section>

      <Section num="03" title="Risks">
        <div className="mb-1">
          {plan.risks.map((r, i) => (
            <Risk key={i} risk={r} />
          ))}
        </div>
      </Section>

      {plan.openQuestions.length > 0 && (
        <Section num="04" title="Open from brainstorm">
          {plan.openQuestions.map((q) => (
            <div
              key={q.id}
              className="mt-1 rounded-md border border-dashed border-line bg-st-review/[0.04] px-3.5 py-3 text-[12.5px] leading-[1.55] text-fg-mute"
            >
              <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-st-review">
                {q.id}
              </span>
              <span className="text-fg-body">
                <InlineMd text={q.body} />
              </span>
            </div>
          ))}
        </Section>
      )}
    </article>
  );
}

function Section({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <h2 className="mb-3 mt-7 flex items-center gap-2 font-mono text-[14px] font-medium uppercase tracking-[0.06em] text-fg-subtle first:mt-0">
        <span className="text-[11.5px] text-fg-ghost">{num}</span>
        {title}
      </h2>
      {children}
    </>
  );
}

function FileRow({ file }: { file: MockPlanFileChange }) {
  return (
    <div className="grid grid-cols-[16px_1fr_auto_auto] items-center gap-3 border-b border-line px-3 py-2 font-mono text-[12px] last:border-b-0">
      <OpBadge op={file.op} />
      <span className="tracking-[0.005em] text-fg">{file.path}</span>
      <span className="font-sans text-[12.5px] tracking-[-0.005em] text-fg-mute">
        <InlineMd text={file.why} />
      </span>
      <span className="text-[11px] text-fg-subtle">{file.delta}</span>
    </div>
  );
}

function OpBadge({ op }: { op: MockPlanFileChange["op"] }) {
  const glyph = op === "new" ? "+" : op === "edit" ? "~" : "−";
  const cls =
    op === "new"
      ? "text-st-done border-st-done/30"
      : op === "edit"
        ? "text-st-progress border-st-progress/30"
        : "text-st-blocked border-st-blocked/30";
  return (
    <span
      className={clsx(
        "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] font-bold leading-none",
        cls,
      )}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

function Risk({ risk }: { risk: MockPlanRisk }) {
  const dotColor = risk.level === "high" ? "bg-st-blocked" : "bg-st-review";
  return (
    <div className="grid grid-cols-[16px_1fr] gap-2.5 border-b border-line py-2 text-[13px] leading-[1.55] last:border-b-0">
      <span className={clsx("mt-[7px] h-1.5 w-1.5 rounded-full", dotColor)} />
      <div className="text-fg-body">
        <InlineMd text={risk.body} />
      </div>
    </div>
  );
}
