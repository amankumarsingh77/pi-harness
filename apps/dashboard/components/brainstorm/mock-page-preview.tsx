"use client";

import { useState } from "react";
import type { BrainstormMockPage } from "@pi-harness/shared";
import { MockScreenshotView } from "./mock-screenshot-view";

function pngUrl(
  taskId: string,
  mockId: string,
  pageId: string,
  viewport: "desktop" | "mobile",
): string {
  return `/api/proxy/tasks/${taskId}/brainstorm/mocks/${mockId}/pages/${pageId}/png/${viewport}`;
}

export function MockPagePreview({
  pages,
  title,
  taskId,
  mockId,
}: {
  pages: ReadonlyArray<BrainstormMockPage>;
  title: string;
  taskId: string;
  mockId: string;
}) {
  const firstPage = pages[0];
  const [activePageId, setActivePageId] = useState(firstPage?.pageId ?? "");
  const activePage = pages.find((page) => page.pageId === activePageId) ?? firstPage;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-6 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {pages.map((page) => {
            const active = page.pageId === activePage?.pageId;
            return (
              <button
                key={page.pageId}
                type="button"
                onClick={() => setActivePageId(page.pageId)}
                className={`shrink-0 rounded border px-2.5 py-1 text-left font-mono text-[11px] ${
                  active
                    ? "border-st-progress/70 bg-st-progress/12 text-st-progress"
                    : "border-line text-fg-body hover:border-line-hover hover:bg-white/[0.03]"
                }`}
              >
                {page.title}
              </button>
            );
          })}
        </div>
        {activePage?.summary && (
          <span className="hidden max-w-sm truncate text-[12px] text-fg-mute lg:block">
            {activePage.summary}
          </span>
        )}
      </div>
      {activePage ? (
        <MockScreenshotView
          key={activePage.pageId}
          title={`${title} — ${activePage.title}`}
          desktopSrc={pngUrl(taskId, mockId, activePage.pageId, "desktop")}
          mobileSrc={pngUrl(taskId, mockId, activePage.pageId, "mobile")}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-card font-mono text-[12px] text-fg-mute">
          Mock has no pages to preview
        </div>
      )}
    </div>
  );
}
