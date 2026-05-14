import Link from "next/link";
import type { Route } from "next";
import type { Task } from "@pi-harness/shared";
import { clsx } from "clsx";
import { PriorityIcon, PRIORITY_LABELS } from "@/components/new-task/priority-icon";
import type { BoardTransition } from "./board";
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

export function TaskCard({
  task,
  pending,
  onDragStart,
  onDragEnd,
  onTransition,
}: {
  task: Task;
  pending: boolean;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
  onTransition: BoardTransition;
}) {
  const kind = statusKindFor(task.status);
  const live = LIVE_STATUSES.has(task.status);
  const attention = FAILED_STATUSES.has(task.status);
  const age = formatRelativeCompact(task.updatedAt ?? task.createdAt);
  const meta = metaLineFor(task);
  const draggable = task.status === "backlog";
  const actions = actionsFor(task);

  return (
    <article
      data-testid={`task-card-${task.id}`}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-pi-task-id", task.id);
        onDragStart(task.id);
      }}
      onMouseDown={() => {
        if (draggable) onDragStart(task.id);
      }}
      onMouseUp={onDragEnd}
      onDragEnd={onDragEnd}
      className={clsx(
        "group relative rounded-md border px-3 py-2.5",
        "transition-colors duration-150",
        attention
          ? "border-st-blocked/60 bg-card hover:border-st-blocked hover:bg-card-hover"
          : "border-line bg-card hover:border-line-hover hover:bg-card-hover",
        draggable && "cursor-grab active:cursor-grabbing",
        pending && "opacity-60",
      )}
    >
      <Link
        href={`/tasks/${task.id}` as Route}
        aria-label={`Open ${task.title}`}
        className="absolute inset-0 z-10 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-line-hover"
      />

      <div className="pointer-events-none relative z-20">
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.01em] text-fg-mute">
          <StatusIcon kind={kind} live={live} />
          <span className="text-fg-mute">#{task.id.slice(0, 4).toUpperCase()}</span>
          {task.priority !== "none" && (
            <span className="inline-flex items-center gap-1 text-fg-body">
              <PriorityIcon value={task.priority} />
              {PRIORITY_LABELS[task.priority]}
            </span>
          )}
          <span className="ml-auto text-fg-faint">{age}</span>
        </div>

        <div
          className={clsx(
            "mt-2 line-clamp-2 text-[13.5px] font-medium leading-[1.4] tracking-[-0.012em]",
            "transition-colors group-hover:text-fg",
            task.status === "done" ? "text-fg-mute" : "text-fg",
          )}
        >
          {task.title}
        </div>

        {task.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-line bg-white/[0.025] px-1.5 py-[1px] font-mono text-[10.5px] tracking-[0.01em] text-fg-mute"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

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
      </div>

      {actions.length > 0 && (
        <div className="relative z-30 mt-2 flex items-center gap-1.5 border-t border-line pt-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={pending}
              aria-label={action.ariaLabel(task.title)}
              onClick={() => onTransition(task.id, action.action)}
              className={clsx(
                "inline-flex h-6 items-center rounded border px-2 text-[11.5px] transition-colors",
                action.variant === "danger"
                  ? "border-line text-st-blocked hover:border-st-blocked hover:bg-white/[0.03]"
                  : action.variant === "review"
                    ? "border-line text-st-review hover:border-st-review hover:bg-white/[0.03]"
                    : "border-line text-fg-body hover:border-line-hover hover:bg-white/[0.03]",
                pending && "cursor-wait opacity-60",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </article>
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
  if (task.workflow) parts.push({ text: task.workflow });
  return parts;
}

type CardAction = {
  label: string;
  variant: "neutral" | "danger" | "review";
  action: Parameters<BoardTransition>[1];
  ariaLabel: (title: string) => string;
};

function actionsFor(task: Task): CardAction[] {
  switch (task.status) {
    case "backlog":
      return [
        {
          label: "Start",
          variant: "neutral",
          action: { type: "user_start_brainstorm", workflow: "backend-feature" },
          ariaLabel: (title) => `Start brainstorm for ${title}`,
        },
      ];
    case "brainstorm_failed":
    case "plan_failed":
    case "code_failed":
    case "verification_failed":
    case "pr_failed":
      return [
        {
          label: "Retry",
          variant: "review",
          action: { type: "user_retry_failed" },
          ariaLabel: (title) => `Retry ${title}`,
        },
        {
          label: "Cancel",
          variant: "danger",
          action: { type: "user_cancel" },
          ariaLabel: (title) => `Cancel ${title}`,
        },
      ];
    case "brainstorming":
    case "planning":
    case "executing":
    case "verifying":
    case "ready_to_ship":
      return [
        {
          label: "Cancel",
          variant: "danger",
          action: { type: "user_cancel" },
          ariaLabel: (title) => `Cancel ${title}`,
        },
      ];
    case "done":
    case "cancelled":
      return [];
  }
}
