import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@pi-harness/shared";
import {
  PhaseEventLogStore,
  type BrainstormPhaseEventInput,
  type PlanPhaseEventInput,
} from "../src/adapters/phase-event-log-store.js";
import { readJsonl } from "../src/adapters/jsonl-writer.js";

describe("PhaseEventLogStore", () => {
  it("writes brainstorm JSONL before publishing the matching run event", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "phase-events-"));
    const published: AgentEvent[] = [];
    const store = new PhaseEventLogStore({
      events: { append: async (event) => { published.push(event); } },
      runs: { findActiveRun: async () => ({ id: "run-1" }) },
    });

    const [event] = await store.publishMany({
      phase: "brainstorm",
      worktreePath,
      taskId: "task-1",
      timestamp: new Date("2026-05-21T00:00:00.000Z"),
      inputs: [answer("q1", "ship")],
    });

    const jsonl = await readJsonl(join(worktreePath, ".harness", "task-1", "brainstorm.jsonl"));
    expect(jsonl).toEqual([
      {
        ts: "2026-05-21T00:00:00.000Z",
        kind: "brainstorm_answer",
        questionId: "q1",
        optionId: "ship",
      },
    ]);
    expect(event).toEqual(published[0]);
    expect(published[0]).toMatchObject({
      runId: "run-1",
      taskId: "task-1",
      ts: new Date("2026-05-21T00:00:00.000Z"),
      kind: "brainstorm_answer",
      questionId: "q1",
      optionId: "ship",
    });
  });

  it("serializes batch writes and publishes each event in order", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "phase-events-batch-"));
    const published: AgentEvent[] = [];
    const store = new PhaseEventLogStore({
      events: { append: async (event) => { published.push(event); } },
      runs: { findActiveRun: async () => ({ id: "run-2" }) },
    });

    await Promise.all([
      store.publish({
        phase: "brainstorm",
        worktreePath,
        taskId: "task-2",
        input: answer("q1", "a"),
      }),
      store.publishMany({
        phase: "brainstorm",
        worktreePath,
        taskId: "task-2",
        inputs: [answer("q2", "b"), answer("q3", "c")],
      }),
    ]);

    const jsonl = await readJsonl(join(worktreePath, ".harness", "task-2", "brainstorm.jsonl"));
    expect(jsonl.map((event) => event["questionId"])).toEqual(["q1", "q2", "q3"]);
    expect(published.map((event) => event.kind)).toEqual([
      "brainstorm_answer",
      "brainstorm_answer",
      "brainstorm_answer",
    ]);
  });

  it("falls back to JSONL-only when no active run exists", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "phase-events-jsonl-only-"));
    const published: AgentEvent[] = [];
    const store = new PhaseEventLogStore({
      events: { append: async (event) => { published.push(event); } },
      runs: { findActiveRun: async () => null },
    });

    const event = await store.publish({
      phase: "brainstorm",
      worktreePath,
      taskId: "task-3",
      input: answer("q1", "fallback"),
    });

    const jsonl = await readJsonl(join(worktreePath, ".harness", "task-3", "brainstorm.jsonl"));
    expect(event).toBeNull();
    expect(published).toEqual([]);
    expect(jsonl).toHaveLength(1);
  });

  it("writes plan events to plan.jsonl", async () => {
    const worktreePath = await mkdtemp(join(tmpdir(), "phase-events-plan-"));
    const store = new PhaseEventLogStore({
      runs: { findActiveRun: async () => ({ id: "run-plan" }) },
    });

    await store.publish({
      phase: "plan",
      worktreePath,
      taskId: "task-plan",
      input: planSystem("session_reset"),
    });

    const jsonl = await readJsonl(join(worktreePath, ".harness", "task-plan", "plan.jsonl"));
    expect(jsonl).toEqual([
      expect.objectContaining({
        kind: "plan_system",
        systemKind: "session_reset",
      }),
    ]);
  });
});

function answer(questionId: string, optionId: string): BrainstormPhaseEventInput {
  return {
    kind: "brainstorm_answer",
    questionId,
    optionId,
  };
}

function planSystem(systemKind: "session_reset"): PlanPhaseEventInput {
  return {
    kind: "plan_system",
    systemKind,
  };
}
