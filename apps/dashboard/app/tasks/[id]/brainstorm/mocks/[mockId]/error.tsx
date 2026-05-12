"use client";

export default function BrainstormMockPreviewError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <div className="px-6 py-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-st-blocked">
        mock preview failed
      </div>
      <div className="mt-1 text-[13px] text-fg-body">{error.message}</div>
    </div>
  );
}
