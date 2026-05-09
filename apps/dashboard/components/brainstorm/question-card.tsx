"use client";
import { useState, useTransition } from "react";
import { clsx } from "clsx";
import type { BrainstormJsonlEvent } from "@/lib/api";
import { submitBrainstormAnswerAction } from "@/app/tasks/[id]/actions";
import { EvidencePill } from "./evidence-pill";

type QuestionEvent = Extract<BrainstormJsonlEvent, { kind: "brainstorm_question" }>;

// rpiv-style structured selector. The user picks an option (or several, if
// the question is multi-select), or types a custom answer in the inline
// "Type something…" row, then clicks Submit. Nothing fires until Submit —
// click → select isn't an irrevocable commit.
//
// Once an answer event lands in the bundle/SSE, the card flips to the
// answered state: picked options keep their green border; if the answer
// was free-text, the typed text shows in a small block.
export function QuestionCard({
  taskId,
  question,
  answered,
}: {
  taskId: string;
  question: QuestionEvent;
  answered: { optionId?: string; optionIds?: string[]; freeText?: string } | undefined;
}) {
  const isMulti = question.multiSelect === true;
  const [pending, start] = useTransition();
  // selection: the set of optionIds currently selected (pre-submit).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // otherActive: true once the user clicks the "Type something…" row.
  const [otherActive, setOtherActive] = useState(false);
  const [freeText, setFreeText] = useState("");

  // The picked optionIds reflected in the answer (post-submit). Used to
  // render the green border on already-answered cards.
  const pickedAfterAnswer: ReadonlySet<string> = answered
    ? new Set([
        ...(answered.optionId ? [answered.optionId] : []),
        ...(answered.optionIds ?? []),
      ])
    : new Set();

  const toggle = (id: string) => {
    if (otherActive) {
      // Switching back to options — drop the inline-input mode.
      setOtherActive(false);
    }
    if (isMulti) {
      setSelected((curr) => {
        const next = new Set(curr);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelected(new Set([id]));
    }
  };

  const activateOther = () => {
    setOtherActive(true);
    setSelected(new Set());
  };

  const canSubmit =
    !pending &&
    !answered &&
    ((otherActive && freeText.trim().length > 0) || (!otherActive && selected.size > 0));

  const submit = () => {
    if (!canSubmit) return;
    const payload = otherActive
      ? { freeText: freeText.trim() }
      : isMulti
        ? { optionIds: [...selected] }
        : { optionId: [...selected][0]! };
    start(async () => {
      await submitBrainstormAnswerAction(taskId, {
        questionId: question.questionId,
        ...payload,
      });
      // Don't reset state — once the answer event lands the card flips to
      // answered mode and the controls disappear.
    });
  };

  return (
    <div className="rounded-md border border-line bg-card p-3.5">
      <div className="mb-2.5 flex items-baseline gap-2">
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
          const isSelected = answered ? pickedAfterAnswer.has(opt.id) : selected.has(opt.id);
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

        {/* Other / free-text inline row. Mirrors rpiv's "Type something." row. */}
        {!answered && (
          <button
            type="button"
            role="radio"
            aria-checked={otherActive}
            disabled={pending}
            onClick={() => (otherActive ? null : activateOther())}
            className={clsx(
              "flex items-start gap-2 rounded border px-3 py-2 text-left transition-colors",
              otherActive
                ? "border-st-progress bg-white/[0.04]"
                : "border-line border-dashed text-fg-mute hover:border-line-hover hover:text-fg-body",
              pending && "cursor-not-allowed opacity-60",
            )}
          >
            <Marker selected={otherActive} multi={false} />
            {otherActive ? (
              <textarea
                autoFocus
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
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

      {!answered && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-fg-subtle">
            {otherActive
              ? "⌘↵ to submit"
              : isMulti
                ? selected.size === 0
                  ? "Pick one or more options"
                  : `${selected.size} selected`
                : selected.size === 0
                  ? "Pick one option"
                  : "1 selected"}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded bg-st-progress px-3 py-1 text-[12px] font-medium text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-white/[0.04] disabled:text-fg-faint disabled:hover:brightness-100"
          >
            {pending ? "Submitting…" : "Submit answer"}
          </button>
        </div>
      )}

      {answered?.freeText && (
        <div className="mt-2 rounded border border-st-done bg-white/[0.04] px-3 py-2 text-[13px] text-fg">
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
