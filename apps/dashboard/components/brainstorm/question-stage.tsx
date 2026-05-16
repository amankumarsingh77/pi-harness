"use client";

import { useState } from "react";
import { QuestionBatch } from "./question-card";
import type { QuestionEvent, QuestionThread, AnswerValue } from "./use-brainstorm-timeline";

export function QuestionThreadStage({
  taskId,
  batch,
}: {
  readonly taskId: string;
  readonly batch: QuestionThread;
}) {
  const [expanded, setExpanded] = useState(batch.state === "open");
  if (batch.state === "open" || expanded) {
    return (
      <section className="brainstorm-focus-card" aria-label="Question batch">
        <QuestionThreadHeader
          batch={batch}
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
        />
        <QuestionBatch taskId={taskId} questions={batch.questions} answered={batch.answered} />
      </section>
    );
  }
  return (
    <section className="brainstorm-focus-card is-squashed" aria-label="Answered question batch">
      <QuestionThreadHeader
        batch={batch}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
      />
      <div className="question-thread-summary">
        {batch.questions.map((question) => (
          <div key={question.questionId} className="question-thread-row">
            <span className="question-thread-id">{question.questionId}</span>
            <span className="question-thread-prompt">{question.prompt}</span>
            <span className="question-thread-answer">
              {answerLabel(question, batch.answered.get(question.questionId))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuestionThreadHeader({
  batch,
  expanded,
  onToggle,
}: {
  readonly batch: QuestionThread;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <div className="question-thread-head">
      <div>
        <h2>{batch.state === "open" ? "Current question" : "Answered questions"}</h2>
        <span>{batch.batchId}</span>
      </div>
      {batch.state === "answered" && (
        <button type="button" onClick={onToggle}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      )}
    </div>
  );
}

function answerLabel(question: QuestionEvent, answer: AnswerValue | undefined): string {
  if (!answer) return "unanswered";
  if (answer.freeText) return answer.freeText;
  const selectedIds = [
    ...(answer.optionId ? [answer.optionId] : []),
    ...(answer.optionIds ?? []),
  ];
  const labels = selectedIds.map((id) => optionLabel(question, id));
  return labels.length > 0 ? labels.join(", ") : "answered";
}

function optionLabel(question: QuestionEvent, optionId: string): string {
  return question.options.find((option) => option.id === optionId)?.label ?? optionId;
}
