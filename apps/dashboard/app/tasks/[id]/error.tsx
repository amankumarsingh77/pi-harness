"use client";

import Link from "next/link";

export default function TaskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[calc(100vh-48px)] flex-col items-start gap-3 px-6 pt-12">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-st-blocked">
        task failed to load
      </span>
      <p className="max-w-xl font-mono text-[12px] text-fg-mute">{error.message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded border border-line bg-card px-3 py-1.5 text-[12.5px] text-fg-body transition-colors hover:border-line-hover"
        >
          Retry
        </button>
        <Link
          href="/"
          className="rounded border border-line bg-card px-3 py-1.5 text-[12.5px] text-fg-body transition-colors hover:border-line-hover"
        >
          Board
        </Link>
      </div>
    </main>
  );
}
