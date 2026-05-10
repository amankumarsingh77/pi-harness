import Link from "next/link";
import type { Route } from "next";
import type { Task } from "@pi-harness/shared";
import { clsx } from "clsx";
import { StatusIcon, statusKindFor } from "./status-icon";
import { formatRelativeCompact } from "@/lib/format";

const LIVE_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "brainstorming",
  "planning",
  "executing",
  "verifying",
]);

// Any failure state needs to grab the user's eye — bordered red so they can
// scan the board and immediately spot what needs triage.
const FAILED_STATUSES: ReadonlySet<Task["status"]> = new Set([
  "brainstorm_failed",
  "plan_failed",
  "code_failed",
  "pr_failed",
  "verification_failed",
]);

export function TaskCard({ task }: { task: Task }) {
  const kind = statusKindFor(task.status);
  const live = LIVE_STATUSES.has(task.status);
  const attention = FAILED_STATUSES.has(task.status);
  const age = formatRelativeCompact(task.updatedAt ?? task.createdAt);
  const meta = metaLineFor(task);

  return (
    <Link
      href={`/tasks/${task.id}` as Route}
      className={clsx(
        "group relative block rounded-md border px-3 py-2.5",
        "transition-colors duration-150",
        attention
          ? "border-st-blocked/60 bg-card hover:border-st-blocked hover:bg-card-hover"
          : "border-line bg-card hover:border-line-hover hover:bg-card-hover",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.01em] text-fg-mute">
        <StatusIcon kind={kind} live={live} />
        <span className="text-fg-mute">#{task.id.slice(0, 4).toUpperCase()}</span>
        <span className="ml-auto text-fg-faint">{age}</span>
        <span
          className={clsx(
            "-mr-1 inline-flex h-[22px] w-[22px] items-center justify-center rounded text-fg-faint",
            "opacity-0 transition-opacity duration-150 hover:bg-white/[0.06] hover:text-fg",
            "group-hover:opacity-100",
          )}
          aria-hidden="true"
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
          </svg>
        </span>
      </div>

      <div
        className={clsx(
          "mt-2 line-clamp-2 text-[13.5px] font-medium leading-[1.4] tracking-[-0.012em]",
          task.status === "done" ? "text-fg-mute" : "text-fg",
        )}
      >
        {task.title}
      </div>

      {meta.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-0 font-mono text-[11.5px] tracking-[0.01em] text-fg-mute">
          {meta.map((part, i) => (
            <span key={i} className={clsx("inline-flex items-center", part.tone && TONE_CLASS[part.tone])}>
              {i > 0 && <span className="px-[7px] text-fg-faint">·</span>}
              {part.text}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

type Tone = "live" | "review" | "blocked" | "merged" | "pr" | "accent";

const TONE_CLASS: Record<Tone, string> = {
  live: "text-st-progress",
  review: "text-st-review",
  blocked: "text-st-blocked",
  merged: "text-st-done",
  pr: "text-st-shipping",
  accent: "text-fg-body",
};

type MetaPart = { text: string; tone?: Tone };

function metaLineFor(task: Task): MetaPart[] {
  const parts: MetaPart[] = [];
  switch (task.status) {
    case "backlog":
      parts.push({ text: "ready to start" });
      break;
    case "brainstorming":
      parts.push({ text: "brainstorm", tone: "live" });
      break;
    case "brainstorm_failed":
      parts.push({ text: "brainstorm failed", tone: "blocked" });
      break;
    case "planning":
      parts.push({ text: "planning", tone: "live" });
      break;
    case "plan_failed":
      parts.push({ text: "plan failed", tone: "blocked" });
      break;
    case "executing":
      parts.push({ text: "code", tone: "live" });
      break;
    case "code_failed":
      parts.push({ text: "code failed", tone: "blocked" });
      break;
    case "verifying":
      parts.push({ text: "verify", tone: "live" });
      break;
    case "verification_failed":
      parts.push({ text: `retry ${task.retryCount}/2`, tone: "blocked" });
      break;
    case "ready_to_ship":
      parts.push({ text: "PR open", tone: "pr" });
      break;
    case "pr_failed":
      parts.push({ text: "PR failed", tone: "blocked" });
      break;
    case "done":
      parts.push({ text: "merged", tone: "merged" });
      break;
    case "cancelled":
      parts.push({ text: "cancelled" });
      break;
  }
  if (task.branchName) parts.push({ text: task.branchName });
  return parts;
}
