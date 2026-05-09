"use client";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-start gap-3 px-6 pt-20">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-st-blocked">
        error
      </span>
      <h1 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-fg">
        Dashboard hit an unexpected error.
      </h1>
      <p className="max-w-xl font-mono text-[12px] text-fg-mute">{error.message}</p>
      {error.digest && (
        <p className="font-mono text-[11px] text-fg-faint">digest · {error.digest}</p>
      )}
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded border border-line bg-card px-3 py-1.5 text-[12.5px] text-fg-body transition-colors hover:border-line-hover"
      >
        Retry
      </button>
    </main>
  );
}
