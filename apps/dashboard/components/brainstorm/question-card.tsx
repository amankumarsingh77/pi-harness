"use client";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import type { BrainstormJsonlEvent } from "@/lib/api";
import { submitBrainstormAnswersAction } from "@/app/tasks/[id]/actions";
import { EvidencePill } from "./evidence-pill";

type QuestionEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }>;
type AnsweredMap = Map<
  string,
  { optionId?: string; optionIds?: string[]; freeText?: string }
>;

// Per-question local selection state. `selected` holds picked option ids;
// `freeText` is the typed answer when the user clicked the "Type your own"
// row. A question is "complete" when the user has either picked at least
// one option OR typed at least one non-whitespace character.
type Draft = {
  selected: Set<string>;
  otherActive: boolean;
  freeText: string;
};
function emptyDraft(): Draft {
  return { selected: new Set(), otherActive: false, freeText: "" };
}
function draftComplete(d: Draft): boolean {
  if (d.otherActive) return d.freeText.trim().length > 0;
  return d.selected.size > 0;
}
function draftPayload(
  q: QuestionEvent,
  d: Draft,
): { questionId: string; optionId?: string; optionIds?: string[]; freeText?: string } {
  if (d.otherActive) {
    return { questionId: q.questionId, freeText: d.freeText.trim() };
  }
  if (q.multiSelect === true) {
    return { questionId: q.questionId, optionIds: [...d.selected] };
  }
  return { questionId: q.questionId, optionId: [...d.selected][0]! };
}

// Renders every question in a single submit_questions batch as one composite
// card with one Submit button. The agent always asks several questions at
// once; submitting individually used to wake the agent on the first answer
// and let it mark ready off partial input. With a per-batch submit, the
// agent only sees a complete set of answers.
export function QuestionBatch({
  taskId,
  questions,
  answered,
}: {
  taskId: string;
  questions: QuestionEvent[];
  answered: AnsweredMap;
}) {
  const allAnswered = questions.every((q) => answered.has(q.questionId));
  const [drafts, setDrafts] = useState<Map<string, Draft>>(
    () => new Map(questions.map((q) => [q.questionId, emptyDraft()])),
  );
  const [pending, start] = useTransition();

  const updateDraft = (questionId: string, fn: (d: Draft) => Draft) => {
    setDrafts((curr) => {
      const next = new Map(curr);
      next.set(questionId, fn(curr.get(questionId) ?? emptyDraft()));
      return next;
    });
  };

  const allComplete = questions.every((q) => {
    if (answered.has(q.questionId)) return true;
    const d = drafts.get(q.questionId) ?? emptyDraft();
    return draftComplete(d);
  });
  const canSubmit = !pending && !allAnswered && allComplete;

  const submit = () => {
    if (!canSubmit) return;
    const payloads = questions
      .filter((q) => !answered.has(q.questionId))
      .map((q) => draftPayload(q, drafts.get(q.questionId) ?? emptyDraft()));
    start(async () => {
      await submitBrainstormAnswersAction(taskId, payloads);
    });
  };

  const onCmdEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
      e.preventDefault();
      submit();
    }
  };

  const incompleteCount = questions.filter((q) => {
    if (answered.has(q.questionId)) return false;
    const d = drafts.get(q.questionId) ?? emptyDraft();
    return !draftComplete(d);
  }).length;
  const remainingLabel =
    incompleteCount === 0
      ? "All set"
      : `${incompleteCount} of ${questions.length} still need an answer`;

  return (
    <div
      className="rounded-md border border-line bg-card p-3.5"
      data-testid="question-batch"
      data-batch-id={questions[0]?.batchId ?? ""}
      onKeyDown={onCmdEnter}
    >
      <div className="mb-2.5 flex items-baseline gap-2 border-b border-line pb-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-mute">
          {questions.length === 1
            ? "1 question"
            : `${questions.length} questions · answer all to submit`}
        </span>
      </div>

      <div className="flex flex-col gap-3.5">
        {questions.map((q) => {
          const ans = answered.get(q.questionId);
          const draft = drafts.get(q.questionId) ?? emptyDraft();
          return (
            <QuestionItem
              key={q.questionId}
              question={q}
              answered={ans}
              draft={draft}
              pending={pending}
              onChange={(fn) => updateDraft(q.questionId, fn)}
            />
          );
        })}
      </div>

      {!allAnswered && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
          <span className="font-mono text-[11px] text-fg-subtle">{remainingLabel}</span>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-st-progress px-3 py-1 text-[12px] font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint disabled:hover:brightness-100"
          >
            {pending
              ? "Submitting…"
              : questions.length === 1
                ? "Submit answer"
                : "Submit all answers"}
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionItem({
  question,
  answered,
  draft,
  pending,
  onChange,
}: {
  question: QuestionEvent;
  answered: { optionId?: string; optionIds?: string[]; freeText?: string } | undefined;
  draft: Draft;
  pending: boolean;
  onChange: (fn: (d: Draft) => Draft) => void;
}) {
  const isMulti = question.multiSelect === true;
  const pickedAfterAnswer: ReadonlySet<string> = answered
    ? new Set([
        ...(answered.optionId ? [answered.optionId] : []),
        ...(answered.optionIds ?? []),
      ])
    : new Set();

  const toggle = (id: string) => {
    onChange((d) => {
      const otherActive = false;
      let selected: Set<string>;
      if (isMulti) {
        selected = new Set(d.selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else {
        selected = new Set([id]);
      }
      return { ...d, selected, otherActive };
    });
  };

  const activateOther = () => {
    onChange((d) => ({ ...d, otherActive: true, selected: new Set() }));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-fg-mute">{question.questionId}</span>
        <span className="text-[13.5px] tracking-[-0.005em] text-fg">{question.prompt}</span>
        {isMulti && !answered && (
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-subtle">
            multi-select
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {question.options.map((opt) => {
          const isSelected = answered
            ? pickedAfterAnswer.has(opt.id)
            : draft.selected.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              role={isMulti ? "checkbox" : "radio"}
              aria-checked={isSelected}
              disabled={pending || !!answered}
              onClick={() => toggle(opt.id)}
              className={clsx(
                "flex flex-col gap-1 rounded border px-3 py-2 text-left transition-colors",
                isSelected
                  ? answered
                    ? "border-st-done bg-white/[0.04] text-fg"
                    : "border-st-progress bg-white/[0.04] text-fg"
                  : "border-line text-fg-body hover:border-line-hover hover:bg-white/[0.03]",
                (pending || !!answered) && "cursor-not-allowed",
                pending && "opacity-60",
              )}
            >
              <div className="flex items-baseline gap-2 text-[13px]">
                <Marker selected={isSelected} multi={isMulti} />
                <span className="flex-1">{opt.label}</span>
                {opt.recommended && (
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-st-progress">
                    recommended
                  </span>
                )}
              </div>
              {opt.description && (
                <div className="ml-5 text-[12px] text-fg-mute">{opt.description}</div>
              )}
              {opt.evidence.length > 0 && (
                <div className="ml-5 flex flex-wrap gap-1">
                  {opt.evidence.map((c) => (
                    <EvidencePill key={c} citation={c} />
                  ))}
                </div>
              )}
            </button>
          );
        })}

        {!answered && (
          <button
            type="button"
            role="radio"
            aria-checked={draft.otherActive}
            disabled={pending}
            onClick={() => (draft.otherActive ? null : activateOther())}
            className={clsx(
              "flex items-start gap-2 rounded border px-3 py-2 text-left transition-colors",
              draft.otherActive
                ? "border-st-progress bg-white/[0.04]"
                : "border-line border-dashed text-fg-mute hover:border-line-hover hover:text-fg-body",
              pending && "cursor-not-allowed opacity-60",
            )}
          >
            <Marker selected={draft.otherActive} multi={false} />
            {draft.otherActive ? (
              <textarea
                autoFocus
                value={draft.freeText}
                onChange={(e) =>
                  onChange((d) => ({ ...d, freeText: e.target.value }))
                }
                disabled={pending}
                placeholder="Type your own answer…"
                className="min-h-7 flex-1 resize-none border-0 bg-transparent p-0 text-[13px] leading-[1.5] text-fg outline-none placeholder:text-fg-faint"
              />
            ) : (
              <span className="text-[13px]">Type something…</span>
            )}
          </button>
        )}
      </div>

      {answered?.freeText && (
        <div className="rounded border border-st-done bg-white/[0.04] px-3 py-2 text-[13px] text-fg">
          <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-mute">
            your answer
          </span>
          {answered.freeText}
        </div>
      )}
    </div>
  );
}

function Marker({ selected, multi }: { selected: boolean; multi: boolean }) {
  if (multi) {
    return (
      <span
        aria-hidden="true"
        className={clsx(
          "mt-[3px] inline-block h-3.5 w-3.5 flex-shrink-0 rounded-[3px] border",
          selected
            ? "border-st-progress bg-st-progress"
            : "border-line-strong bg-transparent",
        )}
      >
        {selected && (
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5">
            <path
              d="M 4 7 L 6 9 L 10 5"
              fill="none"
              stroke="white"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "mt-[3px] inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full border",
        selected ? "border-st-progress bg-st-progress" : "border-line-strong bg-transparent",
      )}
    >
      {selected && <span className="block h-1.5 w-1.5 rounded-full bg-white" />}
    </span>
  );
}
