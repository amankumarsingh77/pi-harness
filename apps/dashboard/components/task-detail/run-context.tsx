import Link from "next/link";
import type { Route } from "next";
import type { Phase, Run, Task } from "@pi-harness/shared";
import { clsx } from "clsx";
import { StatusIcon, type StatusKind } from "@/components/kanban/status-icon";
import { formatDuration, formatRelativeCompact } from "@/lib/format";
import type { RunFile } from "@/lib/api";
import { LiveDuration } from "./live-duration";

/**
 * Right-side panel on /tasks/[id]. Four sections, each justifies its column:
 *
 *  - Run context: KV table — what worktree / branch / start time apply NOW
 *  - Subagents: one row per phase, derived from real `runs[]`. The "active"
 *    row ticks live. (Future: nested rows for pi sub-sessions when the
 *    orchestrator emits subagent_started/ended events.)
 *  - Files touched: paths the coder has edited, with deltas — from
 *    `git diff --numstat` on the worktree.
 *  - Run history: previous runs from the real `runs[]`. Clicking a past
 *    run navigates to `?run=<id>` and the agent log replays that run.
 */

const PHASES_ORDER: Phase[] = ["brainstorm", "plan", "code", "verify", "pr"];

const PHASE_AGENT_NAMES: Record<Phase, string> = {
  brainstorm: "brainstorm-agent",
  plan: "plan-author",
  code: "code-implementer",
  verify: "verification-author",
  pr: "pr-author",
};

const WORKFLOW_TOOLTIP =
  "Workflow controls per-phase model selection (e.g. claude-sonnet for brainstorm, opus for code). Currently only `backend-feature` exists.";

type SubagentRow = {
  phase: Phase;
  name: string;
  status: "queued" | "active" | "done" | "failed" | "cancelled";
  run: Run | null;
};

type RunHistoryRow = {
  run: Run;
  label: string;
  kind: StatusKind;
  age: string;
  current: boolean;
};

export function RunContext({
  task,
  runs,
  files,
  selectedRunId,
}: {
  task: Task;
  runs: Run[];
  files: RunFile[];
  selectedRunId?: string;
}) {
  const lastRun = runs.at(-1);
  const startedAt = runs[0]?.startedAt ?? task.createdAt;
  const startedAgo = formatRelativeCompact(startedAt);
  const runIdShort = lastRun ? lastRun.id.slice(0, 9) : "—";

  const subagents = buildSubagents(runs);
  const history = buildRunHistory(runs, selectedRunId ?? lastRun?.id);

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
        <KV label="workflow">
          <span
            title={WORKFLOW_TOOLTIP}
            className="cursor-help underline decoration-fg-faint decoration-dotted underline-offset-2"
          >
            {task.workflow ?? "—"}
          </span>
        </KV>
      </Section>

      <Section title="Subagents">
        <ul className="flex flex-col gap-1.5">
          {subagents.map((a) => (
            <SubagentItem key={a.phase} row={a} />
          ))}
        </ul>
      </Section>

      <Section title={`Files touched · ${files.length}`}>
        {files.length === 0 ? (
          <p className="font-mono text-[11px] text-fg-faint">no changes yet</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {files.map((f) => (
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
                  +{f.added}
                  {f.removed > 0 ? ` −${f.removed}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Run history">
        {history.length === 0 ? (
          <p className="font-mono text-[11px] text-fg-faint">no runs yet</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((h) => (
              <RunHistoryItem key={h.run.id} row={h} taskId={task.id} />
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}

function SubagentItem({ row }: { row: SubagentRow }) {
  const dotColor =
    row.status === "active"
      ? "var(--color-st-progress)"
      : row.status === "done"
        ? "var(--color-st-done)"
        : row.status === "failed"
          ? "var(--color-st-blocked)"
          : "var(--color-fg-faint)";
  return (
    <li className="flex items-center gap-2.5 text-xs">
      <span
        className={clsx(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          row.status === "active" && "tick-anim",
        )}
        style={{
          background: dotColor,
          boxShadow:
            row.status === "active" ? "0 0 6px rgba(94,106,210,0.5)" : undefined,
        }}
      />
      <span className="font-mono text-[11px] text-fg-body">{row.name}</span>
      <span className="ml-auto font-mono text-[10.5px] text-fg-mute-2">
        <SubagentDuration row={row} />
      </span>
    </li>
  );
}

function SubagentDuration({ row }: { row: SubagentRow }) {
  if (!row.run) return <>queued</>;
  if (row.status === "active") {
    return <LiveDuration startedAt={row.run.startedAt} />;
  }
  if (row.run.endedAt) {
    return (
      <>
        {formatDuration(
          new Date(row.run.endedAt).getTime() - new Date(row.run.startedAt).getTime(),
        )}
      </>
    );
  }
  return <>{row.status}</>;
}

function RunHistoryItem({ row, taskId }: { row: RunHistoryRow; taskId: string }) {
  const href = `/tasks/${taskId}?run=${row.run.id}` as Route;
  const inner = (
    <>
      <StatusIcon kind={row.kind} size={10} />
      <span className="text-fg">{row.run.id.slice(0, 6)}</span>
      <span>{row.label}</span>
      <span className="ml-auto text-fg-mute-2">{row.age}</span>
    </>
  );
  if (row.current) {
    return (
      <li
        className="flex items-center gap-2.5 rounded px-2 py-1.5 font-mono text-[11px] text-fg-body"
        style={{ background: "rgba(94,106,210,0.08)" }}
      >
        {inner}
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2.5 rounded px-2 py-1.5 font-mono text-[11px] text-fg-mute transition-colors hover:bg-white/[0.03]"
      >
        {inner}
      </Link>
    </li>
  );
}

function buildSubagents(runs: Run[]): SubagentRow[] {
  const byPhase = new Map<Phase, Run>();
  for (const r of runs) byPhase.set(r.phase, r);
  return PHASES_ORDER.map((phase) => {
    const run = byPhase.get(phase) ?? null;
    let status: SubagentRow["status"] = "queued";
    if (run) {
      switch (run.status) {
        case "running":
          status = "active";
          break;
        case "succeeded":
          status = "done";
          break;
        case "failed":
          status = "failed";
          break;
        case "cancelled":
          status = "cancelled";
          break;
        default:
          status = "queued";
      }
    }
    return { phase, name: PHASE_AGENT_NAMES[phase], status, run };
  });
}

function buildRunHistory(runs: Run[], selectedId: string | undefined): RunHistoryRow[] {
  // Reverse chronological: latest first.
  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  const latestId = sorted[0]?.id;
  return sorted.map((run) => {
    const current = run.id === (selectedId ?? latestId);
    return {
      run,
      label: runLabel(run),
      kind: runKind(run),
      age: formatRelativeCompact(run.startedAt),
      current,
    };
  });
}

function runLabel(run: Run): string {
  if (run.status === "running") {
    const since = Date.now() - new Date(run.startedAt).getTime();
    return `${run.phase} · ${formatDuration(since)}`;
  }
  if (run.status === "failed") return `${run.phase} failed`;
  if (run.status === "cancelled") return `${run.phase} cancelled`;
  if (run.endedAt) {
    return `${run.phase} · ${formatDuration(
      new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime(),
    )}`;
  }
  return run.phase;
}

function runKind(run: Run): StatusKind {
  if (run.status === "running") return "progress";
  if (run.status === "failed" || run.status === "cancelled") return "blocked";
  if (run.status === "succeeded") return "done";
  return "intake";
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
    <span
      className={clsx(
        "inline-block cursor-pointer text-fg-faint hover:text-fg-body",
        className,
      )}
      title="copy"
    >
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
        <rect
          x="2.5"
          y="3.5"
          width="6"
          height="6"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
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
