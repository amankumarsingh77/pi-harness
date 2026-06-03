import type { Run, Task } from "@pi-harness/shared";
import type { RunFile } from "@/lib/api";
import { formatRelativeCompact } from "@/lib/format";

type DeltaSummary = {
  readonly added: number;
  readonly removed: number;
};

export function TaskFactsPanel({
  task,
  runs,
  files,
  selectedRunId,
  action,
}: {
  readonly task: Task;
  readonly runs: readonly Run[];
  readonly files: readonly RunFile[];
  readonly selectedRunId?: string;
  readonly action?: React.ReactNode;
}) {
  const selectedRun = selectedRunId
    ? runs.find((run) => run.id === selectedRunId)
    : runs.at(-1);
  const delta = summarizeDelta(files);

  return (
    <aside className="overflow-hidden rounded-[10px] border border-line bg-white/[0.018]">
      <div className="flex min-h-[42px] items-center justify-between border-b border-line px-3.5">
        <h2 className="m-0 text-[13px] font-semibold text-fg">Task facts</h2>
        {action}
      </div>
      <div className="grid gap-2.5 p-3">
        <MiniCard title="Run context">
          <KV label="run">{selectedRun ? selectedRun.id.slice(0, 10) : "—"}</KV>
          <KV label="worktree">{task.worktreePath ?? "—"}</KV>
          <KV label="workflow">{task.workflow ?? "—"}</KV>
          <KV label="updated">{`${formatRelativeCompact(task.updatedAt)} ago`}</KV>
        </MiniCard>

        <MiniCard title="Files touched">
          <KV label="files">{files.length === 0 ? "no changes" : `${files.length} changed`}</KV>
          <KV label="delta">
            <span className="text-st-done">+{delta.added}</span>
            <span className="text-fg-subtle"> / </span>
            <span className="text-st-blocked">-{delta.removed}</span>
          </KV>
          <KV label="branch">{task.branchName ?? "—"}</KV>
        </MiniCard>

        <MiniCard title="Run history">
          {runs.length === 0 ? (
            <p className="m-0 font-mono text-[11px] text-fg-faint">No run history yet</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {[...runs].reverse().slice(0, 4).map((run) => (
                <li
                  key={`${run.id}-${run.phase}`}
                  className="flex items-center gap-2 font-mono text-[11px] text-fg-mute"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-st-progress" />
                  <span className="text-fg-body">{run.phase}</span>
                  <span className="text-fg-subtle">{run.status}</span>
                </li>
              ))}
            </ul>
          )}
        </MiniCard>
      </div>
    </aside>
  );
}

function MiniCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-black/10 p-3">
      <h3 className="m-0 mb-2 text-[12px] font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function KV({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <dl className="m-0 grid grid-cols-[82px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 font-mono text-[11px]">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="m-0 truncate text-fg-body">{children}</dd>
    </dl>
  );
}

function summarizeDelta(files: readonly RunFile[]): DeltaSummary {
  return files.reduce<DeltaSummary>(
    (total, file) => ({
      added: total.added + file.added,
      removed: total.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
}
