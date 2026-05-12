import Link from "next/link";

export default function BrainstormMockPreviewNotFound() {
  return (
    <div className="px-6 py-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-st-blocked">
        mock not found
      </div>
      <Link href="/" className="mt-2 inline-block text-[13px] text-fg-body hover:text-fg">
        Back to board
      </Link>
    </div>
  );
}
