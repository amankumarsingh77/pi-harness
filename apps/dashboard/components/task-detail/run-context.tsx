import type { Run, Task } from "@pi-harness/shared";
import { clsx } from "clsx";
import { StatusIcon } from "@/components/kanban/status-icon";
import { formatDuration, formatRelativeCompact } from "@/lib/format";
import type {
  MockFileTouched,
  MockRunHistoryEntry,
  MockSubagent,
} from "@/types/mocks";

/**
 * Right-side panel on /tasks/[id]. Four sections, each justifies its column:
 *
 *  - Run context: KV table — what worktree / branch / start time apply NOW
 *  - Subagents: which orchestrator subagents are active / done / queued
 *  - Files touched: paths the coder has edited, with deltas
 *  - Run history: previous attempts so the user can see why this is run #3
 *
 * Cost / token panel intentionally omitted in the UI-first mock — the user
 * doesn't need to see it on the detail page in v1.
 */

export function RunContext({
  task,
  runs,
  subagents,
  filesTouched,
  runHistory,
}: {
  task: Task;
  runs: Run[];
  subagents: MockSubagent[];
  filesTouched: MockFileTouched[];
  runHistory: MockRunHistoryEntry[];
}) {
  const lastRun = runs.at(-1);
  const startedAt = runs[0]?.startedAt ?? task.createdAt;
  const startedAgo = formatRelativeCompact(startedAt);
  const runIdShort = lastRun ? lastRun.id.slice(0, 9) : "—";

  return (
    <aside className="bg-bg">
      <Section title="Run context">
        <KV label="run id">
          <span>{runIdShort}</span>
          <CopyMark className="ml-1.5" />
        </KV>
        <KV label="branch">{task.branchName ?? "—"}</KV>
        <KV label="worktree">{task.worktreePath ?? "—"}</KV>
        <KV label="started">{`${formatTimeOfDay(startedAt)} · ${startedAgo} ago`}</KV>
        <KV label="workflow">{task.workflow ?? "—"}</KV>
      </Section>

      <Section title="Subagents">
        <ul className="flex flex-col gap-1.5">
          {subagents.map((a) => (
            <li key={a.name} className="flex items-center gap-2.5 text-xs">
              <span
                className={clsx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  a.status === "active"
                    ? "tick-anim"
                    : a.status === "done"
                      ? ""
                      : "",
                )}
                style={{
                  background:
                    a.status === "active"
                      ? "var(--color-st-progress)"
                      : a.status === "done"
                        ? "var(--color-st-done)"
                        : "var(--color-fg-faint)",
                  boxShadow:
                    a.status === "active" ? "0 0 6px rgba(94,106,210,0.5)" : undefined,
                }}
              />
              <span className="font-mono text-[11px] text-fg-body">{a.name}</span>
              <span className="ml-auto font-mono text-[10.5px] text-fg-mute-2">
                {a.durationMs == null ? "queued" : formatDuration(a.durationMs)}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Files touched · ${filesTouched.length}`}>
        <ul className="flex flex-col gap-1.5">
          {filesTouched.map((f) => (
            <li key={f.path} className="flex items-center gap-2.5 text-xs">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background:
                    f.state === "live"
                      ? "var(--color-st-progress)"
                      : "var(--color-st-done)",
                }}
              />
              <span className="truncate font-mono text-[11px] text-fg-body">{f.path}</span>
              <span className="ml-auto font-mono text-[10.5px] text-fg-mute-2">
                +{f.added}{f.removed > 0 ? ` −${f.removed}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Run history">
        <ul className="flex flex-col gap-1">
          {runHistory.map((h) => (
            <li
              key={h.runId}
              className={clsx(
                "flex items-center gap-2.5 rounded px-2 py-1.5 font-mono text-[11px] transition-colors",
                h.current
                  ? "text-fg-body"
                  : "cursor-pointer text-fg-mute hover:bg-white/[0.03]",
              )}
              style={h.current ? { background: "rgba(94,106,210,0.08)" } : undefined}
            >
              <StatusIcon kind={h.kind} size={10} />
              <span className="text-fg">{h.runId}</span>
              <span>{h.label}</span>
              <span className="ml-auto text-fg-mute-2">{h.age}</span>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <h3 className="mb-2.5 font-mono text-[10.5px] font-medium tracking-[0.08em] text-fg-mute-2 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2.5 py-1 text-xs">
      <dt className="font-mono text-[11px] text-fg-mute-2">{label}</dt>
      <dd className="m-0 font-mono text-[11px] break-all text-fg-body">{children}</dd>
    </div>
  );
}

function CopyMark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-block cursor-pointer text-fg-faint hover:text-fg-body", className)} title="copy">
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
        <rect x="2.5" y="3.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
        <path
          d="M 4 3 L 4 2.5 A 0.5 0.5 0 0 1 4.5 2 L 9 2 A 0.5 0.5 0 0 1 9.5 2.5 L 9.5 8 A 0.5 0.5 0 0 1 9 8.5 L 8.5 8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    </span>
  );
}

function formatTimeOfDay(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(11, 19);
}
