"use client";
import { useState } from "react";

export function MockHtmlPreview({
  title,
  htmlSrc,
}: {
  title: string;
  htmlSrc: string;
}) {
  const [vp, setVp] = useState<"desktop" | "mobile">("desktop");
  const viewportClass = vp === "desktop" ? "h-[800px] w-[1280px]" : "h-[844px] w-[390px]";
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
      <div data-mock-preview-scroll className="min-h-0 flex-1 overflow-auto bg-bg">
        <div className={`${viewportClass} max-w-none bg-bg`}>
          <iframe
            title={`Mock preview ${title}`}
            src={htmlSrc}
            sandbox=""
            className="h-full w-full border-0 bg-bg"
          />
        </div>
      </div>
    </div>
  );
}
