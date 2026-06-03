import type { Claim, ClaimEvent, MissionEvent, MissionPacket, Run, Task } from "@pi-harness/shared";
import { FileText, Gavel, RadioTower, ScrollText, ShieldCheck } from "lucide-react";

const CLAIM_STATUS_ORDER: readonly Claim["status"][] = [
  "pending",
  "challenged",
  "proven",
  "failed",
  "accepted_risk",
];

export function MissionCommandShell({
  task,
  mission,
  claims,
  missionEvents,
  claimEvents,
  runs,
  onRunVerifier,
  verifierPending,
  verifierError,
}: {
  readonly task: Task;
  readonly mission: MissionPacket;
  readonly claims: readonly Claim[];
  readonly missionEvents: readonly MissionEvent[];
  readonly claimEvents: readonly ClaimEvent[];
  readonly runs: readonly Run[];
  readonly onRunVerifier: () => void;
  readonly verifierPending: boolean;
  readonly verifierError?: string;
}) {
  const counts = countClaims(claims);
  const latestRun = runs.at(-1) ?? null;
  const transcript = combinedTranscript(missionEvents, claimEvents);

  return (
    <>
      <nav
        aria-label="Mission sections"
        className="mb-4 flex gap-2 overflow-x-auto rounded-[8px] border border-line bg-card p-2"
      >
        <SectionAnchor href="#mission-packet" label="Mission Packet" />
        <SectionAnchor href="#claim-ledger" label="Claim Ledger" />
        <SectionAnchor href="#runtime-status" label="Runtime" />
        <SectionAnchor href="#filtered-transcript" label="Transcript" />
        <SectionAnchor href="#policy-kernel" label="Policy" />
      </nav>

      <section className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)_minmax(0,0.95fr)]">
      <Panel id="mission-packet" title="Mission Packet" eyebrow={mission.workflowIntent} icon={FileText}>
        <div className="space-y-5">
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-faint">
              Goal
            </div>
            <p className="m-0 text-[15px] leading-6 text-fg">{mission.goal}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Metric label="Risk" value={mission.riskLevel} tone={riskTone(mission.riskLevel)} />
            <Metric label="Policy" value={mission.policyProfile} />
          </div>

          <TokenList label="Success Criteria" items={mission.successCriteria} />
          <TokenList label="Affected Areas" items={mission.affectedAreas} empty="None recorded" />
          <TokenList label="Constraints" items={mission.constraints} empty="None recorded" />

          <div className="border-t border-line pt-3 font-mono text-[11px] text-fg-faint">
            Updated <time dateTime={mission.updatedAt}>{formatIso(mission.updatedAt)}</time>
          </div>
        </div>
      </Panel>

      <Panel id="claim-ledger" title="Claim Ledger" eyebrow={`${claims.length} claims`} icon={Gavel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-line bg-white/[0.02] p-3">
          <div>
            <div className="text-[13px] font-medium text-fg">Verifier sidecar</div>
            <p className="mt-1 mb-0 text-[12px] leading-5 text-fg-mute">
              Runs pending scenario claims and streams proof transitions back here.
            </p>
            {verifierError && (
              <p className="mt-2 mb-0 text-[12px] leading-5 text-red-fg2">{verifierError}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onRunVerifier}
            disabled={verifierPending}
            className="h-9 shrink-0 rounded-[6px] border border-line bg-fg px-3 text-[12px] font-medium text-bg transition hover:bg-fg/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verifierPending ? "Running..." : "Run verifier"}
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-2 xl:grid-cols-5">
          {CLAIM_STATUS_ORDER.map((status) => (
            <Metric key={status} label={statusLabel(status)} value={String(counts[status] ?? 0)} tone={statusTone(status)} />
          ))}
        </div>

        {claims.length === 0 ? (
          <EmptyState title="No claims yet" detail="Plan approval will seed DAG and scenario claims." />
        ) : (
          <div className="space-y-3">
            {claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} />
            ))}
          </div>
        )}
      </Panel>

      <Panel id="runtime-status" title="Runtime Status" eyebrow={task.status} icon={RadioTower}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Runs" value={String(runs.length)} />
            <Metric
              label="Latest"
              value={latestRun ? runLabel(latestRun) : "none"}
              {...(latestRun ? { tone: runTone(latestRun.status) } : {})}
            />
          </div>

          {runs.length === 0 ? (
            <EmptyState title="No runs recorded" detail="Execution has not started for this task." />
          ) : (
            <div className="space-y-2">
              {runs.slice(-5).map((run) => (
                <div
                  key={run.id}
                  className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/60 py-2 last:border-b-0"
                >
                  <span className="font-mono text-[11px] text-fg-mute">{run.phase}</span>
                  <span className="min-w-0 truncate text-[13px] text-fg">{run.status}</span>
                  <span className="font-mono text-[11px] text-fg-faint">
                    ${run.costUsd.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel id="filtered-transcript" title="Filtered Transcript" eyebrow={`${transcript.length} events`} icon={ScrollText}>
        {transcript.length === 0 ? (
          <EmptyState title="No mission transcript events" detail="Mission and claim updates will appear here." />
        ) : (
          <div className="space-y-2">
            {transcript.slice(-8).map((event) => (
              <div key={event.key} className="border-b border-line/60 py-2 last:border-b-0">
                <div className="font-mono text-[11px] text-fg-faint">{formatIso(event.ts)}</div>
                <div className="mt-1 text-[13px] text-fg">{event.label}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel id="policy-kernel" title="Policy Kernel" eyebrow="deferred" icon={ShieldCheck}>
        <div className="space-y-3">
          <Metric label="Profile" value={mission.policyProfile} />
          <EmptyState title="No policy decisions recorded" detail="This slice keeps policy read-only while the ledger becomes durable." />
        </div>
      </Panel>
    </section>
    </>
  );
}

function Panel({
  id,
  title,
  eyebrow,
  icon: Icon,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly icon: React.ComponentType<{ readonly size?: number; readonly strokeWidth?: number; readonly className?: string }>;
  readonly children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-[8px] border border-line bg-card p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="m-0 flex items-center gap-2 text-[14px] font-semibold text-fg">
          <Icon size={15} strokeWidth={1.8} className="text-fg-mute" aria-hidden="true" />
          {title}
        </h2>
        <span className="max-w-[180px] truncate font-mono text-[11px] text-fg-faint">{eyebrow}</span>
      </header>
      {children}
    </section>
  );
}

function SectionAnchor({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  return (
    <a
      href={href}
      className="whitespace-nowrap rounded-md border border-line px-3 py-1.5 font-mono text-[11px] text-fg-mute transition-colors hover:border-line-hover hover:bg-white/[0.03] hover:text-fg-body"
    >
      {label}
    </a>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <div className="min-w-0 rounded-[6px] border border-line bg-white/[0.025] px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-faint">
        {label}
      </div>
      <div className={`mt-1 truncate text-[13px] font-medium ${toneClass(tone)}`}>{value}</div>
    </div>
  );
}

function TokenList({
  label,
  items,
  empty = "None",
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly empty?: string;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-fg-faint">
        {label}
      </div>
      {items.length === 0 ? (
        <p className="m-0 text-[13px] text-fg-mute">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {items.map((item) => (
            <li
              key={item}
              className="max-w-full rounded-full border border-line bg-white/[0.025] px-2.5 py-1 font-mono text-[11px] text-fg-mute"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClaimRow({ claim }: { readonly claim: Claim }) {
  return (
    <article className="rounded-[8px] border border-line bg-black/[0.08] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${statusBadgeClass(claim.status)}`}>
          {statusLabel(claim.status)}
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] text-fg-faint">
          {claim.sourceKey}
        </span>
      </div>
      <p className="m-0 text-[13px] leading-5 text-fg">{claim.text}</p>
      {claim.verifierNote && (
        <p className="mt-2 mb-0 text-[12px] leading-5 text-fg-mute">{claim.verifierNote}</p>
      )}
      {claim.evidence.length > 0 && (
        <ul className="mt-3 flex list-none flex-wrap gap-2 p-0">
          {claim.evidence.map((evidence) => (
            <li
              key={`${evidence.kind}:${evidence.ref}:${evidence.note ?? ""}`}
              className="rounded-full border border-line bg-white/[0.025] px-2 py-0.5 font-mono text-[10px] text-fg-mute"
            >
              {evidence.kind}:{evidence.ref}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function EmptyState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-line bg-white/[0.015] p-4">
      <div className="text-[13px] font-medium text-fg">{title}</div>
      <p className="mt-1 mb-0 text-[12px] leading-5 text-fg-mute">{detail}</p>
    </div>
  );
}

function countClaims(claims: readonly Claim[]): Partial<Record<Claim["status"], number>> {
  return claims.reduce<Partial<Record<Claim["status"], number>>>((acc, claim) => {
    acc[claim.status] = (acc[claim.status] ?? 0) + 1;
    return acc;
  }, {});
}

function statusLabel(status: Claim["status"]): string {
  switch (status) {
    case "pending":
      return "pending";
    case "challenged":
      return "challenged";
    case "proven":
      return "proven";
    case "failed":
      return "failed";
    case "accepted_risk":
      return "accepted risk";
  }
}

function statusTone(status: Claim["status"]): "neutral" | "good" | "warn" | "bad" {
  switch (status) {
    case "proven":
      return "good";
    case "challenged":
    case "accepted_risk":
      return "warn";
    case "failed":
      return "bad";
    case "pending":
      return "neutral";
  }
}

function statusBadgeClass(status: Claim["status"]): string {
  switch (status) {
    case "proven":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "challenged":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "failed":
      return "border-rose-400/30 bg-rose-400/10 text-rose-200";
    case "accepted_risk":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    case "pending":
      return "border-line bg-white/[0.025] text-fg-mute";
  }
}

function riskTone(risk: MissionPacket["riskLevel"]): "neutral" | "good" | "warn" | "bad" {
  switch (risk) {
    case "low":
      return "good";
    case "medium":
      return "warn";
    case "high":
      return "bad";
  }
}

function runLabel(run: Run): string {
  return `${run.phase} ${run.status}`;
}

function runTone(status: Run["status"]): "neutral" | "good" | "warn" | "bad" {
  switch (status) {
    case "succeeded":
      return "good";
    case "failed":
    case "cancelled":
      return "bad";
    case "running":
      return "warn";
    case "pending":
      return "neutral";
  }
}

function toneClass(tone: "neutral" | "good" | "warn" | "bad"): string {
  switch (tone) {
    case "good":
      return "text-emerald-200";
    case "warn":
      return "text-amber-200";
    case "bad":
      return "text-rose-200";
    case "neutral":
      return "text-fg";
  }
}

function eventLabel(event: MissionEvent): string {
  switch (event.type) {
    case "mission.initialized":
      return "Mission initialized";
    case "mission.updated":
      return "Mission updated";
  }
}

type TranscriptEvent = {
  readonly key: string;
  readonly ts: string;
  readonly label: string;
};

function combinedTranscript(
  missionEvents: readonly MissionEvent[],
  claimEvents: readonly ClaimEvent[],
): readonly TranscriptEvent[] {
  return [
    ...missionEvents.map((event) => ({
      key: `mission:${event.type}:${event.ts}`,
      ts: event.ts,
      label: eventLabel(event),
    })),
    ...claimEvents.map((event) => ({
      key: `claim:${event.type}:${claimEventTimestamp(event)}:${event.claimId}`,
      ts: claimEventTimestamp(event),
      label: claimEventLabel(event),
    })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function claimEventTimestamp(event: ClaimEvent): string {
  return event.type === "claim.created" ? event.createdAt : event.updatedAt;
}

function claimEventLabel(event: ClaimEvent): string {
  switch (event.type) {
    case "claim.created":
      return `Claim seeded from ${event.sourceKey}`;
    case "claim.status_changed":
      return `Claim ${event.claimId} marked ${event.status}`;
    case "claim.evidence_added":
      return `Evidence added to ${event.claimId}`;
    case "claim.note_added":
      return `Verifier note added to ${event.claimId}`;
  }
}

function formatIso(value: string): string {
  return value.replace("T", " ").replace(".000Z", "Z");
}
