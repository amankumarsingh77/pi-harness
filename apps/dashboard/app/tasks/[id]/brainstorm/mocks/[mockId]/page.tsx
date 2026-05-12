import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { MockPreviewActions } from "@/components/brainstorm/mock-preview-actions";
import { ApiError } from "@/lib/api";
import { orchestrator } from "@/lib/server/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; mockId: string }>;
}): Promise<Metadata> {
  const { id, mockId } = await params;
  return { title: `${id} · ${mockId} · brainstorm mock · pi-harness` };
}

export default async function BrainstormMockPreviewPage({
  params,
}: {
  params: Promise<{ id: string; mockId: string }>;
}) {
  const { id, mockId } = await params;
  const [taskResult, manifest, html] = await Promise.all([
    orchestrator.getTask(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    orchestrator.getBrainstormMocks(id).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    orchestrator.getBrainstormMockHtml(id, mockId).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
  ]);
  const mock = manifest.mocks.find((m) => m.mockId === mockId);
  if (!mock) notFound();

  const { task } = taskResult;
  const selected = manifest.selectedMockId === mockId;

  return (
    <>
      <Topbar runningCount={1} blockedCount={1} doneTodayCount={12} branch="main" />
      <section className="flex h-[calc(100vh-48px)] min-h-0 flex-col bg-bg">
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-3">
          <nav className="flex items-center gap-1.5 font-mono text-[11px] text-fg-subtle">
            <Link href="/" className="text-fg-mute hover:text-fg-body">← Board</Link>
            <span className="text-fg-faint">/</span>
            <Link href={`/tasks/${task.id}/brainstorm` as never} className="text-fg-body hover:text-fg">
              {task.id}
            </Link>
            <span className="text-fg-faint">/</span>
            <span className="text-st-review">{mock.mockId}</span>
          </nav>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-fg">{mock.title}</h1>
            <p className="truncate text-[12px] text-fg-mute">{mock.summary}</p>
          </div>
          {selected && (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-done">
              selected
            </span>
          )}
          <MockPreviewActions taskId={task.id} mockId={mock.mockId} selected={selected} />
        </header>
        <div className="min-h-0 flex-1 bg-card">
          <iframe
            title={`Mock preview ${mock.title}`}
            srcDoc={html}
            sandbox=""
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </section>
    </>
  );
}
