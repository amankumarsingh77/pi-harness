import Link from "next/link";
import type { Route } from "next";
import type { Task, TaskStatus } from "@pi-harness/shared";
import type { BrainstormGate, BrainstormJsonlEvent, PlanGate } from "@/lib/api";
import { StatusIcon } from "@/components/kanban/status-icon";

export type TaskInterventionPhase = "brainstorm" | "plan" | "verify";

export type TaskIntervention = {
  readonly phase: TaskInterventionPhase;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly cta: string;
};

export type TaskInterventionInput = {
  readonly task: Task;
  readonly brainstorm?: {
    readonly gate: BrainstormGate;
    readonly events: readonly BrainstormJsonlEvent[];
  };
  readonly plan?: {
    readonly gate: PlanGate;
  };
};

export function deriveTaskIntervention({
  task,
  brainstorm,
  plan,
}: TaskInterventionInput): TaskIntervention | null {
  if (task.status === "brainstorming" && brainstorm) {
    return deriveBrainstormIntervention(task, brainstorm);
  }

  if (task.status === "planning" && plan?.gate === "awaiting_user") {
    return {
      phase: "plan",
      title: "Plan is ready for review",
      detail: "Review the plan, request changes, or approve it from the plan phase page.",
      href: `/tasks/${task.id}/plan`,
      cta: "Review plan",
    };
  }

  return failedIntervention(task);
}

function deriveBrainstormIntervention(
  task: Task,
  brainstorm: NonNullable<TaskInterventionInput["brainstorm"]>,
): TaskIntervention | null {
  if (hasUnansweredQuestion(brainstorm.events)) {
    return {
      phase: "brainstorm",
      title: "Brainstorm needs your answers",
      detail: "Answer the open question batch from the brainstorm phase page.",
      href: `/tasks/${task.id}/brainstorm`,
      cta: "Answer questions",
    };
  }

  if (needsMockSelection(brainstorm.events)) {
    return {
      phase: "brainstorm",
      title: "Brainstorm needs a mock selection",
      detail: "Select the preferred mock direction from the brainstorm phase page.",
      href: `/tasks/${task.id}/brainstorm`,
      cta: "Select mock",
    };
  }

  if (brainstorm.gate === "awaiting_user") {
    return {
      phase: "brainstorm",
      title: "Brainstorm is ready for review",
      detail: "Review design and spec from the brainstorm phase page before advancing.",
      href: `/tasks/${task.id}/brainstorm`,
      cta: "Review brainstorm",
    };
  }

  return null;
}

function hasUnansweredQuestion(events: readonly BrainstormJsonlEvent[]): boolean {
  const answeredQuestionIds = new Set(
    events
      .filter((event): event is Extract<BrainstormJsonlEvent, { kind: "brainstorm_answer" }> =>
        event.kind === "brainstorm_answer",
      )
      .map((event) => event.questionId),
  );

  return events.some(
    (event) =>
      event.kind === "brainstorm_question" && !answeredQuestionIds.has(event.questionId),
  );
}

function needsMockSelection(events: readonly BrainstormJsonlEvent[]): boolean {
  const selectedMock = events.some((event) => event.kind === "brainstorm_mock_selected");
  if (selectedMock) return false;

  return events.some(
    (event) =>
      event.kind === "brainstorm_mock_proposed" ||
      event.kind === "brainstorm_mock_revised",
  );
}

function failedIntervention(task: Task): TaskIntervention | null {
  const phase = failedPhase(task.status);
  if (!phase) return null;

  return {
    phase,
    title: `${phaseLabel(phase)} needs attention`,
    detail: `Open the ${phaseLabel(phase).toLowerCase()} phase page to inspect and recover this failure.`,
    href: `/tasks/${task.id}/${phase}`,
    cta: `Open ${phaseLabel(phase).toLowerCase()}`,
  };
}

function failedPhase(status: TaskStatus): TaskInterventionPhase | null {
  switch (status) {
    case "brainstorm_failed":
      return "brainstorm";
    case "plan_failed":
      return "plan";
    case "verification_failed":
      return "verify";
    default:
      return null;
  }
}

function phaseLabel(phase: TaskInterventionPhase): string {
  switch (phase) {
    case "brainstorm":
      return "Brainstorm";
    case "plan":
      return "Plan";
    case "verify":
      return "Verify";
  }
}

export function TaskInterventionStrip({
  intervention,
}: {
  readonly intervention: TaskIntervention;
}) {
  return (
    <section className="flex items-center gap-3.5 border-b border-line bg-card px-6 py-3">
      <span
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-bg text-st-review"
      >
        <StatusIcon kind="review" size={14} />
      </span>
      <div className="min-w-0 flex-1 leading-[1.45]">
        <div className="text-[13px] font-semibold tracking-[-0.01em] text-fg">
          {intervention.title}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-fg-mute">
          {intervention.detail}
        </div>
      </div>
      <Link
        href={intervention.href as Route}
        className="rounded-md border border-line bg-transparent px-3 py-1.5 text-[12.5px] text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
      >
        {intervention.cta} <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
