import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactKind, ArtifactStatus } from "@pi-harness/shared";
import { ArtifactsStore } from "../src/agents/artifacts-store.js";
import { readJsonl } from "../src/adapters/jsonl-writer.js";
import { TaskMutationLock } from "../src/runner/task-mutation-lock.js";
import { TaskWorkflowService } from "../src/services/task-workflow-service.js";
import { createBareTestStores, resetTestStore } from "./helpers/stores.js";

describe("TaskWorkflowService", () => {
  const { stateDir, runs, events } = createBareTestStores();
  const artifacts = new ArtifactsStore();
  let scratch: string;
  let enqueue: ReturnType<typeof vi.fn<[string], void>>;
  let workflow: TaskWorkflowService;

  beforeEach(async () => {
    await resetTestStore(stateDir);
    scratch = await mkdtemp(join(tmpdir(), "task-workflow-"));
    enqueue = vi.fn();
    workflow = new TaskWorkflowService({
      runs,
      events,
      artifacts,
      mutationLock: new TaskMutationLock(),
      enqueue,
      retryCap: 2,
    });
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("starts a backlog task and enqueues exactly once", async () => {
    const task = await runs.createTask({ title: "start me" });

    const result = await workflow.applyUserTransition(task.id, {
      type: "user_start_brainstorm",
      workflow: "backend-feature",
    });

    expect(result.task).toMatchObject({
      id: task.id,
      status: "brainstorming",
      workflow: "backend-feature",
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(task.id);
  });

  it("approves brainstorm by closing the active run and moving to planning", async () => {
    const task = await runs.createTask({ title: "approve brainstorm" });
    const worktreePath = await makeWorktree();
    await Promise.all([
      writeArtifact(worktreePath, task.id, "design", "ready"),
      writeArtifact(worktreePath, task.id, "spec", "ready"),
    ]);
    await runs.updateTask(task.id, {
      status: "brainstorming",
      workflow: "backend-feature",
      worktreePath,
      branchName: `pi/${task.id}`,
    });
    const run = await runs.createRun({ taskId: task.id, phase: "brainstorm" });
    await runs.updateRun(run.id, { status: "running" });

    const result = await workflow.applyUserTransition(task.id, {
      type: "user_approve_brainstorm",
    });

    expect(result.task.status).toBe("planning");
    await expect(runs.getRun(run.id)).resolves.toMatchObject({
      status: "succeeded",
      error: null,
    });
    const stream = await events.listForRun(run.id);
    expect(stream).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "phase_ended",
          phase: "brainstorm",
          status: "succeeded",
        }),
      ]),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(task.id);
  });

  it("requests plan changes by resetting all plan artifacts and recording one revision event", async () => {
    const task = await runs.createTask({ title: "revise plan" });
    const worktreePath = await makeWorktree();
    for (const kind of ["plan", "scenarios", "blast-radius", "execution-dag"] as const) {
      await writeArtifact(worktreePath, task.id, kind, "ready");
    }
    await runs.updateTask(task.id, {
      status: "planning",
      workflow: "backend-feature",
      worktreePath,
      branchName: `pi/${task.id}`,
    });
    const run = await runs.createRun({ taskId: task.id, phase: "plan" });
    await runs.updateRun(run.id, { status: "running" });

    const result = await workflow.applyUserTransition(task.id, {
      type: "user_request_plan_changes",
      comment: "Please tighten the execution sequence and risks.",
    });

    expect(result.task.status).toBe("planning");
    for (const kind of ["plan", "scenarios", "blast-radius", "execution-dag"] as const) {
      await expect(artifacts.readArtifact(worktreePath, task.id, kind)).resolves.toMatchObject({
        fm: { status: "draft" },
      });
    }
    const jsonl = await readJsonl<{ readonly kind?: string; readonly comment?: string }>(
      join(worktreePath, ".harness", task.id, "plan.jsonl"),
    );
    expect(jsonl).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plan_revision_requested",
          comment: "Please tighten the execution sequence and risks.",
        }),
      ]),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(task.id);
  });

  it("routes verifier failures through the retry policy and persisted run settlement", async () => {
    const task = await runs.createTask({ title: "verify retry" });
    const verifying = await runs.updateTask(task.id, {
      status: "verifying",
      workflow: "backend-feature",
      retryCount: 0,
    });
    const run = await runs.createRun({ taskId: task.id, phase: "verify" });
    const runningRun = await runs.updateRun(run.id, { status: "running" });

    const result = await workflow.completePhaseRun({
      task: verifying,
      phase: "verify",
      run: runningRun,
      result: {
        ok: false,
        error: "verification failed",
        inputTokens: 10,
        outputTokens: 4,
        costUsd: 0.02,
      },
    });

    expect(result).toMatchObject({
      status: "executing",
      retryCount: 1,
    });
    await expect(runs.getRun(run.id)).resolves.toMatchObject({
      status: "failed",
      error: "verification failed",
      inputTokens: 10,
      outputTokens: 4,
      costUsd: 0.02,
    });
  });

  async function makeWorktree(): Promise<string> {
    const dir = await mkdtemp(join(scratch, "wt-"));
    await mkdir(join(dir, ".harness"), { recursive: true });
    return dir;
  }

  async function writeArtifact(
    worktreePath: string,
    taskId: string,
    kind: ArtifactKind,
    status: ArtifactStatus,
  ): Promise<void> {
    await artifacts.writeArtifact(worktreePath, taskId, {
      fm: {
        task: taskId,
        kind,
        parent: parentFor(kind),
        status,
        branch: `pi/${taskId}`,
        last_updated: new Date("2026-05-29T00:00:00.000Z").toISOString(),
        last_updated_by: "test",
      },
      body: `# ${kind}\n`,
    });
  }
});

function parentFor(kind: ArtifactKind): string | null {
  if (kind === "spec") return "design.md";
  if (kind === "scenarios" || kind === "blast-radius" || kind === "execution-dag") {
    return "plan.md";
  }
  return null;
}
