import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact } from "@pi-harness/shared";
import type { ArtifactsStore } from "./artifacts-store.js";
import type { BrainstormEventBus } from "./brainstorm-event-bus.js";
import {
  BRAINSTORM_SCRIPT,
  type BrainstormAnswer,
  type QuestionStep,
} from "./brainstorm-script.js";

export type BrainstormOpts = {
  taskId: string;
  cwd: string;                  // worktree path
  store: ArtifactsStore;
  bus: BrainstormEventBus;
};

export type BrainstormResult = {
  ok: boolean;
  // True only when the agent reached `ready` — both artifacts now have
  // status: ready. False (with ok:true) means we halted on a question and
  // are waiting for the user.
  ready: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};

// Run one "tick" of the scripted brainstorm subagent. Walks BRAINSTORM_SCRIPT
// from the cursor (computed from JSONL), emitting events through the bus and
// updating design.md / spec.md as user answers arrive. Halts on the next
// unanswered question; returns ready=true once `ready` is reached.
//
// This is a mock — it doesn't talk to a real LLM. The cost / token fields
// stay zero. See brainstorm-script.ts for the canned content.
export async function runBrainstorm(opts: BrainstormOpts): Promise<BrainstormResult> {
  try {
    const events = readJsonlEvents(opts.cwd, opts.taskId);
    const answers = collectAnswers(events);
    const cursor = computeCursor(answers);

    for (let i = cursor; i < BRAINSTORM_SCRIPT.length; i++) {
      const step = BRAINSTORM_SCRIPT[i]!;
      switch (step.kind) {
        case "probe": {
          if (!hasSystemEvent(events, "probe_complete")) {
            await opts.bus.publish({ kind: "brainstorm_system", systemKind: "probe_complete" });
          }
          break;
        }
        case "question": {
          const answered = answers.find((a) => a.questionId === step.id);
          if (!answered) {
            if (!hasQuestionEvent(events, step.id)) {
              await opts.bus.publish({
                kind: "brainstorm_question",
                questionId: step.id,
                prompt: step.prompt,
                options: step.options,
                sectionTarget: step.sectionTarget,
                ...(step.multiSelect ? { multiSelect: true } : {}),
              });
            }
            return { ok: true, ready: false, costUsd: 0, inputTokens: 0, outputTokens: 0 };
          }
          await applyAnswerToArtifact(opts, step, answered);
          break;
        }
        case "questions": {
          // Emit every question in the batch that isn't already in the JSONL.
          // Halt as soon as we know at least one is still unanswered. When
          // all are answered, fold each answer into its target artifact and
          // advance past the batch.
          for (const q of step.questions) {
            if (!hasQuestionEvent(events, q.id)) {
              await opts.bus.publish({
                kind: "brainstorm_question",
                questionId: q.id,
                prompt: q.prompt,
                options: q.options,
                sectionTarget: q.sectionTarget,
                ...(q.multiSelect ? { multiSelect: true } : {}),
              });
            }
          }
          const allAnswered = step.questions.every((q) =>
            answers.some((a) => a.questionId === q.id),
          );
          if (!allAnswered) {
            return { ok: true, ready: false, costUsd: 0, inputTokens: 0, outputTokens: 0 };
          }
          for (const q of step.questions) {
            const ans = answers.find((a) => a.questionId === q.id)!;
            await applyAnswerToArtifact(opts, q, ans);
          }
          break;
        }
        case "self_critique": {
          if (!hasSystemEvent(events, "self_critique_passed")) {
            await opts.bus.publish({
              kind: "brainstorm_system",
              systemKind: "self_critique_passed",
            });
          }
          break;
        }
        case "ready": {
          await markReady(opts);
          if (!hasSystemEvent(events, "status_changed")) {
            await opts.bus.publish({
              kind: "brainstorm_system",
              systemKind: "status_changed",
              data: { status: "ready" },
            });
          }
          return { ok: true, ready: true, costUsd: 0, inputTokens: 0, outputTokens: 0 };
        }
      }
    }
    return { ok: true, ready: true, costUsd: 0, inputTokens: 0, outputTokens: 0 };
  } catch (e) {
    return {
      ok: false,
      ready: false,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: (e as Error).message,
    };
  }
}

type JsonlEvent = Record<string, unknown> & { type?: string; kind?: string };

function readJsonlEvents(cwd: string, taskId: string): JsonlEvent[] {
  const path = join(cwd, ".harness", taskId, "brainstorm.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as JsonlEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is JsonlEvent => e !== null);
}

function collectAnswers(events: JsonlEvent[]): BrainstormAnswer[] {
  return events
    .filter((e) => e.kind === "brainstorm_answer")
    .map((e) => ({
      questionId: String(e.questionId ?? ""),
      ...(typeof e.optionId === "string" ? { optionId: e.optionId } : {}),
      ...(Array.isArray(e.optionIds) && e.optionIds.every((s) => typeof s === "string")
        ? { optionIds: e.optionIds as string[] }
        : {}),
      ...(typeof e.freeText === "string" ? { freeText: e.freeText } : {}),
    }));
}

function hasSystemEvent(events: JsonlEvent[], systemKind: string): boolean {
  return events.some((e) => e.kind === "brainstorm_system" && e.systemKind === systemKind);
}

function hasQuestionEvent(events: JsonlEvent[], questionId: string): boolean {
  return events.some((e) => e.kind === "brainstorm_question" && e.questionId === questionId);
}

// Given the answers seen so far, return the index in BRAINSTORM_SCRIPT to
// resume from. We resume *at* the next un-fully-handled step, not after the
// last answered question — this lets us re-walk an answered question to
// apply its answer to the artifact body (idempotent thanks to our
// hasQuestionEvent / hasSystemEvent guards on emission).
//
// Practically: we always start from 0. The handler short-circuits emission
// for events already in the JSONL, so the cost of re-walking is just a few
// reads and `applyAnswerToArtifact` calls.
export function computeCursor(_answers: BrainstormAnswer[]): number {
  return 0;
}

async function applyAnswerToArtifact(
  opts: BrainstormOpts,
  step: QuestionStep,
  answer: BrainstormAnswer,
): Promise<void> {
  const cur = await opts.store.readArtifact(opts.cwd, opts.taskId, step.sectionTarget.artifact);
  if (!cur) return;
  const sectionLine = `## ${step.sectionTarget.section}`;
  const newLine = step.answerToBody(answer);
  // Idempotent: if the answer line is already in the body, no-op.
  if (cur.body.includes(newLine)) return;
  const body = cur.body.includes(sectionLine)
    ? appendUnderSection(cur.body, sectionLine, newLine)
    : `${cur.body.trim()}\n\n${sectionLine}\n\n${newLine}\n`;
  const next: Artifact = {
    fm: {
      ...cur.fm,
      last_updated: new Date().toISOString(),
      last_updated_by: "brainstorm-agent",
    },
    body,
  };
  await opts.store.writeArtifact(opts.cwd, opts.taskId, next);
}

function appendUnderSection(body: string, sectionLine: string, line: string): string {
  // Insert `line` immediately after the section heading. Stays simple — no
  // attempt to deduplicate; multiple revisions accumulate.
  const idx = body.indexOf(sectionLine);
  const insertAt = idx + sectionLine.length;
  return `${body.slice(0, insertAt)}\n\n${line}${body.slice(insertAt)}`;
}

async function markReady(opts: BrainstormOpts): Promise<void> {
  for (const kind of ["design", "spec"] as const) {
    const cur = await opts.store.readArtifact(opts.cwd, opts.taskId, kind);
    if (!cur) continue;
    if (cur.fm.status === "ready" || cur.fm.status === "approved") continue;
    await opts.store.writeArtifact(opts.cwd, opts.taskId, {
      fm: {
        ...cur.fm,
        status: "ready",
        last_updated: new Date().toISOString(),
        last_updated_by: "brainstorm-agent",
      },
      body: cur.body,
    });
  }
}
