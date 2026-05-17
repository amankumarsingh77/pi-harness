import Link from "next/link";
import type { Metadata, Route } from "next";

export const metadata: Metadata = { title: "New task · pi-harness" };
import { Topbar } from "@/components/topbar";
import { orchestrator } from "@/lib/server/api";
import { PriorityPicker } from "@/components/new-task/priority-picker";
import { TagInput } from "@/components/new-task/tag-input";
import { createTask } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const { counts } = await orchestrator.listTasks();
  const inFlight =
    (counts.brainstorming ?? 0) +
    (counts.planning ?? 0) +
    (counts.executing ?? 0) +
    (counts.verifying ?? 0);

  return (
    <>
      <Topbar runningCount={inFlight} />
      <main className="mx-auto mb-20 mt-10 max-w-5xl px-8">
        <nav className="mb-4 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
          <Link href={"/" as Route} className="inline-flex items-center gap-1 text-fg-mute hover:text-fg-body">
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
              <path
                d="M 9 6 L 3 6 M 6 3 L 3 6 L 6 9"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Board
          </Link>
          <span className="text-fg-ghost">/</span>
          <span className="text-fg-body">New task</span>
        </nav>

        <form action={createTask} className="overflow-hidden rounded-lg border border-line bg-card">
          <header className="flex items-center gap-2.5 border-b border-line px-6 py-4">
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 text-st-idle" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.4" />
            </svg>
            <h1 className="m-0 font-display text-[15px] font-semibold tracking-[-0.012em] text-fg">
              Create a task
            </h1>
          </header>

          <div className="px-6 py-5">
            <Field label="Title" hint="one line, present tense">
              <input
                name="title"
                required
                maxLength={200}
                autoFocus
                placeholder="Add per-user rate limiting on /api/upload"
                className="w-full rounded-md border border-line bg-input px-3 py-2.5 text-[14px] leading-[1.5] tracking-[-0.005em] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-st-progress"
              />
            </Field>

            <Field
              label="Description"
              hint="supports markdown · the brainstorm agent reads this verbatim"
            >
              <textarea
                name="description"
                rows={6}
                placeholder={`What's the goal? Any constraints? Existing files to look at?\n\ne.g. — Throttle /api/upload to 30 req/min per user. Reset hourly. Should respect the existing token-bucket helper in src/lib/throttle.ts.`}
                className="w-full resize-y rounded-md border border-line bg-input px-3 py-2.5 text-[14px] leading-[1.6] tracking-[-0.005em] text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-st-progress"
              />
            </Field>

            <Field label="Priority" hint="how the orchestrator orders the queue">
              <PriorityPicker name="priority" />
            </Field>

            <Field label="Tags" hint="shown on the kanban card · enter or comma to add">
              <TagInput name="tags" />
            </Field>

            <div className="mt-5 flex items-center gap-2.5 border-t border-line pt-4">
              <span className="flex-1 font-mono text-[11px] leading-[1.6] text-fg-subtle">
                Creating a task does <span className="text-fg-body">not</span> start a run — no
                worktree, no LLM tokens spent.
              </span>
              <Link
                href={"/" as Route}
                className="rounded-md border border-line bg-transparent px-3.5 py-2 text-[13px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
              >
                Cancel
              </Link>
              <button
                type="submit"
                className="rounded-md border-0 bg-st-progress px-3.5 py-2 text-[13px] font-medium text-white transition-[filter] hover:brightness-110"
              >
                Create task
              </button>
            </div>
          </div>
        </form>
      </main>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 block">
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-fg-mute">
        <span>{label}</span>
        {hint && <span className="text-[11px] normal-case tracking-[0.01em] text-fg-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
