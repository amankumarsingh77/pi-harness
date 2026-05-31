"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { ChatThread } from "@pi-harness/shared";

type Props = {
  readonly threads: readonly ChatThread[];
  readonly activeThreadId: string | null;
  readonly onNewChat: () => void;
  readonly onSelectThread: (id: string) => void;
  /** Injected for deterministic grouping in tests */
  readonly now?: Date;
};

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[date.getDay()] ?? `${diffDays}d`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Chat-history rail with thread groups (Today / Earlier), search filter,
 * active highlight, and "New chat" button. (REQ-003)
 */
export function ChatRail({ threads, activeThreadId, onNewChat, onSelectThread, now: nowProp }: Props) {
  const [search, setSearch] = useState("");
  // `now` is resolved after mount (or injected in tests) so the server-rendered
  // HTML carries no clock-derived text — relative times and Today/Earlier
  // grouping would otherwise differ between SSR and hydration. (fixes hydration mismatch)
  const [mountedNow, setMountedNow] = useState<Date | null>(nowProp ?? null);
  useEffect(() => {
    if (!nowProp) setMountedNow(new Date());
  }, [nowProp]);
  const now = mountedNow;

  const filtered = threads.filter(
    (t) => !search || t.title.toLowerCase().includes(search.toLowerCase()),
  );

  // Before `now` resolves, show every thread in one undated group so SSR and the
  // first client render agree; grouping + timestamps appear once mounted.
  const today = now ? filtered.filter((t) => sameDay(new Date(t.updatedAt), now)) : filtered;
  const earlier = now ? filtered.filter((t) => !sameDay(new Date(t.updatedAt), now)) : [];

  function ThreadItem({ thread }: { thread: ChatThread }) {
    const isActive = thread.id === activeThreadId;
    const time = now ? relativeTime(new Date(thread.updatedAt), now) : "";
    return (
      <button
        key={thread.id}
        type="button"
        data-testid={`thread-${thread.id}`}
        data-active={isActive}
        onClick={() => onSelectThread(thread.id)}
        className={clsx(
          "block w-full rounded-md px-2 py-[7px] text-left transition-colors",
          isActive ? "bg-[var(--color-sub)]" : "hover:bg-[var(--color-card-hover)]",
        )}
      >
        <div className="flex items-center gap-[7px]">
          <span
            className={clsx(
              "h-1.5 w-1.5 flex-none rounded-full",
              isActive ? "text-[var(--color-st-progress)]" : "text-[var(--color-fg-faint)]",
            )}
            style={{ background: "currentColor" }}
          />
          <span
            className={clsx(
              "min-w-0 flex-1 truncate text-[12.5px]",
              isActive ? "text-[var(--color-fg)]" : "text-[var(--color-fg-body)]",
            )}
          >
            {thread.title}
          </span>
        </div>
        <div
          data-testid={`thread-meta-${thread.id}`}
          className="mt-0.5 flex gap-2 pl-3.5 font-mono text-[10.5px] text-[var(--color-fg-faint)]"
        >
          {thread.branch && <span>{thread.branch}</span>}
          <span>{time}</span>
        </div>
      </button>
    );
  }

  return (
    <aside
      data-testid="chat-rail"
      aria-label="Chat history"
      className="flex min-h-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg)]"
    >
      {/* header */}
      <div className="flex h-11 flex-none items-center gap-2 border-b border-[var(--color-line)] px-[14px]">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-[var(--color-fg)]">
          <span className="h-[7px] w-[7px] rotate-45 bg-[var(--color-fg)]" />
          pi-harness
        </span>
      </div>

      {/* new chat button */}
      <div className="px-[10px] pb-[6px] pt-[10px]">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-[30px] w-full items-center gap-[7px] rounded-md border border-[var(--color-line)] px-[10px] text-[12.5px] text-[var(--color-fg-body)] transition-colors hover:border-[var(--color-line-hover)] hover:bg-[var(--color-card-hover)]"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="M5.5 1.5V9.5M1.5 5.5H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          New chat
          <span className="ml-auto font-mono text-[10.5px] text-[var(--color-fg-faint)]">⌘⇧O</span>
        </button>
      </div>

      {/* search */}
      <label className="mx-[10px] mb-2 flex h-7 items-center gap-[7px] rounded-md border border-[var(--color-line)] bg-[var(--color-input)] px-[9px] text-[12px] text-[var(--color-fg-faint)]">
        <span className="font-mono">/</span>
        <input
          type="text"
          placeholder="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border-none bg-transparent outline-none text-[var(--color-fg-body)] placeholder:text-[var(--color-fg-faint)]"
        />
      </label>

      {/* thread list */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-[6px] pb-[14px]">
        {today.length > 0 && (
          <>
            <div className="pb-[5px] pl-2 pt-3 text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-fg-faint)]">
              {now ? "Today" : "Chats"}
            </div>
            {today.map((t) => <ThreadItem key={t.id} thread={t} />)}
          </>
        )}
        {earlier.length > 0 && (
          <>
            <div className="pb-[5px] pl-2 pt-3 text-[10.5px] uppercase tracking-[0.06em] text-[var(--color-fg-faint)]">
              Earlier
            </div>
            {earlier.map((t) => <ThreadItem key={t.id} thread={t} />)}
          </>
        )}
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-[12px] text-[var(--color-fg-faint)]">No chats found.</p>
        )}
      </div>
    </aside>
  );
}
