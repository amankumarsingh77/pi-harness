"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import type { ChatThread } from "@pi-harness/shared";
import { GitBranch, MessageSquarePlus, Plus, Search } from "lucide-react";

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

  const filtered = threads.filter((thread) => threadMatchesSearch(thread, search));

  // Before `now` resolves, show every thread in one undated group so SSR and the
  // first client render agree; grouping + timestamps appear once mounted.
  const today = now ? filtered.filter((t) => sameDay(new Date(t.updatedAt), now)) : filtered;
  const earlier = now ? filtered.filter((t) => !sameDay(new Date(t.updatedAt), now)) : [];

  function ThreadItem({ thread }: { thread: ChatThread }) {
    const isActive = thread.id === activeThreadId;
    const time = now ? relativeTime(new Date(thread.updatedAt), now) : "";
    const title = displayThreadTitle(thread);
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
            {title}
          </span>
        </div>
        <div
          data-testid={`thread-meta-${thread.id}`}
          className="mt-0.5 flex min-w-0 items-center gap-2 pl-3.5 font-mono text-[10.5px] text-[var(--color-fg-faint)]"
        >
          {thread.branch && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <GitBranch size={10} strokeWidth={1.8} aria-hidden="true" />
              {thread.branch}
            </span>
          )}
          <span>{thread.model.model}</span>
          {time && <span className="ml-auto shrink-0">{time}</span>}
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
      {/* new chat button — the global top nav carries the brand, so the rail
          starts directly with the thread controls. */}
      <div className="px-[10px] pb-[6px] pt-[10px]">
        <button
          type="button"
          onClick={onNewChat}
          className="flex h-[30px] w-full items-center gap-[7px] rounded-md border border-[var(--color-line)] px-[10px] text-[12.5px] text-[var(--color-fg-body)] transition-colors hover:border-[var(--color-line-hover)] hover:bg-[var(--color-card-hover)]"
        >
          <Plus size={13} strokeWidth={1.9} aria-hidden="true" />
          New chat
          <span className="ml-auto font-mono text-[10.5px] text-[var(--color-fg-faint)]">⌘⇧O</span>
        </button>
      </div>

      {/* search */}
      <label className="mx-[10px] mb-2 flex h-7 items-center gap-[7px] rounded-md border border-[var(--color-line)] bg-[var(--color-input)] px-[9px] text-[12px] text-[var(--color-fg-faint)]">
        <Search size={12} strokeWidth={1.8} aria-hidden="true" />
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
          <div className="mx-2 mt-3 rounded-md border border-dashed border-[var(--color-line)] px-3 py-4 text-center">
            <MessageSquarePlus
              size={16}
              strokeWidth={1.8}
              className="mx-auto mb-2 text-[var(--color-fg-faint)]"
              aria-hidden="true"
            />
            <p className="m-0 text-[12px] text-[var(--color-fg-mute)]">
              {threads.length === 0 ? "No chats yet." : "No chats match this search."}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

function threadMatchesSearch(thread: ChatThread, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [
    displayThreadTitle(thread),
    thread.id,
    thread.branch ?? "",
    thread.model.provider,
    thread.model.model,
  ].join(" ").toLowerCase().includes(needle);
}

function displayThreadTitle(thread: ChatThread): string {
  const title = thread.title.trim();
  if (title.length > 0 && !looksGeneratedTitle(title, thread.id)) return title;
  const date = new Date(thread.updatedAt);
  const suffix = Number.isNaN(date.getTime())
    ? thread.id.slice(0, 8)
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Chat ${suffix}`;
}

function looksGeneratedTitle(title: string, id: string): boolean {
  const normalized = title.toLowerCase();
  return (
    normalized === id.toLowerCase() ||
    normalized === "new chat" ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(title) ||
    /^[0-9a-f]{12,}$/i.test(title)
  );
}
