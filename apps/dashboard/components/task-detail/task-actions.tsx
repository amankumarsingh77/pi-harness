import { clsx } from "clsx";
import type { Task } from "@pi-harness/shared";
import { transitionTask } from "@/app/tasks/[id]/actions";

type Variant = "primary" | "neutral" | "danger" | "review";

/**
 * Header action buttons on /tasks/[id]. Renders only the transitions the
 * state machine permits for the current status (see orchestrator
 * domain/state-machine.ts). Each button is its own <form> so it submits
 * independently — the action is bound via .bind() so no client JS runs to
 * shape the payload.
 */
export function TaskActions({ task }: { task: Task }) {
  const buttons = actionsFor(task);
  if (buttons.length === 0) {
    return (
      <span className="font-mono text-[11px] text-fg-faint">
        {task.status === "done" ? "merged" : "no actions available"}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {buttons.map((b) => (
        <form key={b.label} action={transitionTask.bind(null, task.id, b.action)}>
          <ActionButton label={b.label} variant={b.variant} />
        </form>
      ))}
    </div>
  );
}

function ActionButton({ label, variant }: { label: string; variant: Variant }) {
  return (
    <button
      type="submit"
      className={clsx(
        "inline-flex items-center gap-1.5 rounded border px-2.5 py-[5px] text-xs transition-colors",
        VARIANT[variant],
      )}
    >
      {label}
    </button>
  );
}

const VARIANT: Record<Variant, string> = {
  primary: "border-st-progress bg-st-progress text-white hover:brightness-110",
  neutral: "border-line text-fg-body hover:border-line-hover hover:bg-white/[0.03]",
  danger: "border-line text-st-blocked hover:border-st-blocked hover:bg-white/[0.03]",
  review: "border-line text-st-review hover:border-st-review hover:bg-white/[0.03]",
};

type ButtonSpec = {
  label: string;
  variant: Variant;
  action: Parameters<typeof transitionTask>[1];
};

function actionsFor(task: Task): ButtonSpec[] {
  switch (task.status) {
    case "backlog":
      return [
        {
          label: "Start brainstorm",
          variant: "primary",
          action: { type: "user_start_brainstorm", workflow: "backend-feature" },
        },
        { label: "Cancel", variant: "danger", action: { type: "user_cancel" } },
      ];
    case "planning":
      return [
        { label: "Approve plan", variant: "primary", action: { type: "user_approve_plan" } },
        { label: "Cancel", variant: "danger", action: { type: "user_cancel" } },
      ];
    case "verification_failed":
      return [
        { label: "Retry", variant: "review", action: { type: "user_retry_failed" } },
        { label: "Cancel", variant: "danger", action: { type: "user_cancel" } },
      ];
    case "brainstorming":
    case "executing":
    case "verifying":
    case "ready_to_ship":
      return [{ label: "Cancel", variant: "danger", action: { type: "user_cancel" } }];
    case "done":
    case "cancelled":
      return [];
  }
}
