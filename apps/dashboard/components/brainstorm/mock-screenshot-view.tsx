"use client";
import { useState } from "react";

export function MockScreenshotView({
  title,
  desktopSrc,
  mobileSrc,
}: {
  title: string;
  desktopSrc: string;
  mobileSrc: string;
}) {
  const [vp, setVp] = useState<"desktop" | "mobile">("desktop");
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-bg px-6 py-2">
        {(["desktop", "mobile"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVp(v)}
            className={`shrink-0 rounded border px-2.5 py-1 font-mono text-[11px] ${
              vp === v
                ? "border-st-progress/70 bg-st-progress/12 text-st-progress"
                : "border-line text-fg-body hover:border-line-hover hover:bg-white/[0.03]"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <img
          alt={`Mock preview ${title}`}
          src={vp === "desktop" ? desktopSrc : mobileSrc}
          className="block w-full"
        />
      </div>
    </div>
  );
}
