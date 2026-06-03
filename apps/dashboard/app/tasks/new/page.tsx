import Link from "next/link";
import type { Metadata, Route } from "next";
import { ArrowLeft, ClipboardPlus } from "lucide-react";

export const metadata: Metadata = { title: "New task · pi-harness" };
import { Topbar } from "@/components/topbar";
import { orchestrator } from "@/lib/server/api";
import { PriorityPicker } from "@/components/new-task/priority-picker";
import { TagInput } from "@/components/new-task/tag-input";
import { StageModelSelector } from "@/components/new-task/stage-model-selector";
import { createTask } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const [{ counts }, modelCatalog] = await Promise.all([
    orchestrator.listTasks(),
    orchestrator.getProviders(),
  ]);
  const inFlight =
    (counts.brainstorming ?? 0) +
    (counts.planning ?? 0) +
    (counts.executing ?? 0) +
    (counts.verifying ?? 0);

  return (
    <>
      <Topbar runningCount={inFlight} />
      <main className="mx-auto mb-20 mt-8 w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <nav
          className="mb-4 flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle"
          aria-label="Breadcrumb"
        >
          <Link href={"/" as Route} className="inline-flex items-center gap-1 text-fg-mute hover:text-fg-body">
            <ArrowLeft size={12} strokeWidth={1.8} aria-hidden="true" />
            Board
          </Link>
          <span className="text-fg-ghost">/</span>
          <span className="text-fg-body">New task</span>
        </nav>

        <form
          action={createTask}
          aria-label="Create task form"
          className="overflow-hidden rounded-lg border border-line bg-card shadow-[0_16px_48px_rgba(0,0,0,0.16)]"
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white/[0.03] text-st-progress">
              <ClipboardPlus size={17} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 font-display text-[18px] font-semibold tracking-[-0.016em] text-fg">
                Create a task
              </h1>
              <p className="m-0 mt-1 text-[12.5px] leading-[1.5] text-fg-mute">
                Capture the request, then choose the models each agent stage should use.
              </p>
            </div>
          </header>

          <div className="px-5 py-5 sm:px-6">
            <Field label="Title" htmlFor="new-task-title" hint="one line, present tense">
              <input
                id="new-task-title"
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
              htmlFor="new-task-description"
              hint="supports markdown · the brainstorm agent reads this verbatim"
            >
              <textarea
                id="new-task-description"
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

            <StageModelSelector initialCatalog={modelCatalog} />
          </div>
        </form>
      </main>
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  const LabelElement = htmlFor ? "label" : "span";
  return (
    <div className="mb-4 block">
      <div className="mb-1.5 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.04em] text-fg-mute">
        <LabelElement {...(htmlFor ? { htmlFor } : {})}>{label}</LabelElement>
        {hint && <span className="text-[11px] normal-case tracking-[0.01em] text-fg-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
