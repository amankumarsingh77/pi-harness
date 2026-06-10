import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { EventStore } from "../src/adapters/event-store.js";
import { WorktreeManager } from "../src/adapters/worktree.js";

vi.mock("../src/runner/phase-prompts.js", () => ({
  runPhase: vi.fn(),
}));

import { runLoop } from "../src/runner/run-loop.js";
import { runPhase, type PhaseDeps } from "../src/runner/phase-prompts.js";
import { CancellationRegistry } from "../src/runner/cancellation.js";
import { ArtifactsStore } from "../src/agents/artifacts-store.js";
import { createBareTestStores, resetTestStore } from "./helpers/stores.js";

const phaseDepsBase: PhaseDeps = {
  cwd: "/tmp",
  onEvent: () => {},
  createAgentSession: vi.fn(),
  // Mocked runPhase doesn't actually use store, but run-loop reads artifacts
  // post-phase to compute the brainstorm gate. Stub the methods it touches.
  store: new ArtifactsStore(),
  eventStore: { append: vi.fn(async () => {}) } as EventStore,
  exec: vi.fn(),
};

describe("runLoop", () => {
  const { stateDir, runs, events } = createBareTestStores();
  let scratch: string;
  let repo: string;
  let worktrees: WorktreeManager;

  beforeEach(async () => {
    await resetTestStore(stateDir);
    vi.mocked(runPhase).mockReset();
    scratch = await mkdtemp(join(tmpdir(), "rl-test-"));
    repo = join(scratch, "repo");
    await mkdir(repo, { recursive: true });
    const repoGit = simpleGit(repo);
    await repoGit.init();
    await repoGit.addConfig("user.email", "test@example.com", false, "local");
    await repoGit.addConfig("user.name", "Test", false, "local");
    await writeFile(join(repo, "README.md"), "init\n");
    await repoGit.add("README.md");
    await repoGit.commit("init");
    await repoGit.raw(["branch", "-M", "main"]);
    worktrees = new WorktreeManager({ repoRoot: repo, worktreesDir: join(scratch, "worktrees") });
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("brainstorm phase succeeded but artifacts not ready → no advance, no gate", async () => {
    const t = await runs.createTask({ title: "loop" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0.0001,
      inputTokens: 1,
      outputTokens: 1,
    });
    // store.readArtifact returns null (no artifacts written by mocked phase),
    // so the run-loop should NOT transition into awaitingApproval.

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    // Mid-Q&A: stays in brainstorming. The gate is derived from filesystem
    // facts on read; we only assert the persisted status here.
    expect(after.status).toBe("brainstorming");
    expect(runPhase).toHaveBeenCalledTimes(1);
  });

  it("marks brainstorm run as running before invoking the phase driver", async () => {
    const t = await runs.createTask({ title: "brainstorm-running" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    vi.mocked(runPhase).mockImplementation(async () => {
      const runId = vi.mocked(runPhase).mock.calls[0]![1].runId;
      await expect(runs.getRun(runId)).resolves.toMatchObject({ status: "running" });
      return {
        ok: true,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    });

    await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });
  });

  it("marks plan run as running before invoking the phase driver", async () => {
    const t = await runs.createTask({ title: "plan-running" });
    await runs.updateTask(t.id, { status: "planning", workflow: "backend-feature" });

    vi.mocked(runPhase).mockImplementation(async () => {
      const runId = vi.mocked(runPhase).mock.calls[0]![1].runId;
      await expect(runs.getRun(runId)).resolves.toMatchObject({ status: "running" });
      return {
        ok: true,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    });

    await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });
  });

  it("brainstorm non-progress failure ends the run and moves task to brainstorm_failed", async () => {
    const t = await runs.createTask({ title: "stuck-brainstorm" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: false,
      costUsd: 0.0001,
      inputTokens: 1,
      outputTokens: 1,
      error: "brainstorm: agent ended turn without questions or ready",
    });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(after.status).toBe("brainstorm_failed");
    const list = await runs.listRuns(t.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("failed");
    expect(list[0]!.endedAt).not.toBeNull();
    expect(list[0]!.error).toBe("brainstorm: agent ended turn without questions or ready");
  });

  it("brainstorm phase succeeded with both artifacts ready → gate awaits user", async () => {
    const t = await runs.createTask({ title: "ready" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    const readyStore = new ArtifactsStore();
    const readyDeps: PhaseDeps = {
      ...phaseDepsBase,
      store: readyStore,
    };

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: readyDeps,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(after.status).toBe("brainstorming");
    await Promise.all([
      readyStore.setArtifactStatus(after.worktreePath!, t.id, "design", "ready", "agent"),
      readyStore.setArtifactStatus(after.worktreePath!, t.id, "spec", "ready", "agent"),
    ]);
    // The run-loop only persists status. The gate is computed on read by
    // deriveBrainstormGate; the run-loop's responsibility is to *not advance*
    // when the gate would say awaiting_user. Re-running the loop here would
    // be a no-op because the gate check at entry returns early.
    const second = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: readyDeps,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });
    expect(second.status).toBe("brainstorming");
    // runPhase was only called once — the second pass hit the gate.
    expect(runPhase).toHaveBeenCalledTimes(1);

    // Single Run row, still `running` with endedAt unset. The phase ends only
    // when the user approves (handled in routes/tasks.ts) — keeping the run
    // open across the awaiting-user pause is what lets the dashboard's SSE
    // subscription survive a request-changes round-trip.
    const list = await runs.listRuns(t.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe("running");
    expect(list[0]!.endedAt).toBeNull();
  });

  it("creates worktree + branch + draft scaffold on brainstorm entry", async () => {
    const t = await runs.createTask({ title: "scaffold" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    // Task picked up branch + worktree path
    expect(after.branchName).toBe(`pi/${t.id}`);
    expect(after.worktreePath).toBeTruthy();

    // Worktree is registered with git
    const list = await worktrees.list();
    expect(list.find((w) => w.taskId === t.id)).toBeDefined();

    // Artifacts were written with draft frontmatter
    const designPath = join(after.worktreePath!, ".harness", t.id, "design.md");
    const specPath = join(after.worktreePath!, ".harness", t.id, "spec.md");
    const design = await readFile(designPath, "utf8");
    const spec = await readFile(specPath, "utf8");
    expect(design).toContain("kind: design");
    expect(design).toContain("status: draft");
    expect(design).toContain(`branch: pi/${t.id}`);
    expect(spec).toContain("kind: spec");
    expect(spec).toContain("parent: design.md");
    expect(spec).toContain("status: draft");

    // Scaffolding artifacts are runtime state, not git commits.
    const wtGit = simpleGit(after.worktreePath!);
    const log = await wtGit.log();
    expect(log.latest?.message).toBe("init");
  });

  it("threads worktree path as cwd into phaseDeps", async () => {
    const t = await runs.createTask({ title: "cwd-thread" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    const passedDeps = vi.mocked(runPhase).mock.calls[0]![2]!;
    // cwd should be the worktree path, NOT phaseDepsBase.cwd ("/tmp")
    expect(passedDeps.cwd).not.toBe("/tmp");
    expect(passedDeps.cwd).toContain("worktrees");
    expect(passedDeps.cwd).toContain(t.id);
  });

  it("re-dispatch reuses the same worktree (idempotent ensure)", async () => {
    const t = await runs.createTask({ title: "reentry" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    // Reset task back to brainstorming to simulate a re-dispatch
    await runs.updateTask(t.id, { status: "brainstorming" });

    // Should NOT throw on second pass even though worktree exists
    await expect(
      runLoop({
        task: await runs.getTask(t.id),
        runs,
        events,
        phaseDeps: phaseDepsBase,
        worktrees,
        retryCap: 2,
        cancellation: new CancellationRegistry(),
      }),
    ).resolves.toBeDefined();

    const list = await worktrees.list();
    expect(list.filter((w) => w.taskId === t.id)).toHaveLength(1);
  });

  it("does not restart a cancelled brainstorm phase during recovery", async () => {
    const t = await runs.createTask({ title: "paused-brainstorm" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });
    const run = await runs.createRun({ taskId: t.id, phase: "brainstorm" });
    await runs.updateRun(run.id, { status: "cancelled", endedAt: new Date() });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(after.status).toBe("brainstorming");
    expect(runPhase).not.toHaveBeenCalled();
    expect(await runs.listRuns(t.id)).toHaveLength(1);
    expect(await worktrees.list()).toHaveLength(0);
  });

  it("does not restart a cancelled plan phase during recovery", async () => {
    const t = await runs.createTask({ title: "paused-plan" });
    await runs.updateTask(t.id, { status: "planning", workflow: "backend-feature" });
    const run = await runs.createRun({ taskId: t.id, phase: "plan" });
    await runs.updateRun(run.id, { status: "cancelled", endedAt: new Date() });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(after.status).toBe("planning");
    expect(runPhase).not.toHaveBeenCalled();
    expect(await runs.listRuns(t.id)).toHaveLength(1);
    expect(await worktrees.list()).toHaveLength(0);
  });

  it("verify failure with retries left → executing, retryCount++", async () => {
    const t = await runs.createTask({ title: "fail" });
    await runs.updateTask(t.id, { status: "verifying", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: false,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: "scenario failed",
    });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(after.status).toBe("executing");
    expect(after.retryCount).toBe(1);
  });

  it("dispatches code after plan approval and advances to verifying on success", async () => {
    const t = await runs.createTask({ title: "code dispatch" });
    await runs.updateTask(t.id, { status: "executing", workflow: "backend-feature" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0.25,
      inputTokens: 15,
      outputTokens: 5,
      branch: `pi/${t.id}`,
    });

    const after = await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(after.status).toBe("verifying");
    expect(runPhase).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({
        taskId: t.id,
        ticketTitle: "code dispatch",
      }),
      expect.objectContaining({
        cwd: expect.stringContaining("worktrees"),
      }),
    );
    const list = await runs.listRuns(t.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      phase: "code",
      status: "succeeded",
      costUsd: 0.25,
      inputTokens: 15,
      outputTokens: 5,
    });
  });

  it("reuses an existing active code run during recovery instead of creating a duplicate", async () => {
    const t = await runs.createTask({ title: "active-code-recovery" });
    await runs.updateTask(t.id, { status: "executing", workflow: "backend-feature" });
    const active = await runs.createRun({ taskId: t.id, phase: "code" });
    await runs.updateRun(active.id, { status: "running" });

    vi.mocked(runPhase).mockResolvedValue({
      ok: true,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    await runLoop({
      task: await runs.getTask(t.id),
      runs,
      events,
      phaseDeps: phaseDepsBase,
      worktrees,
      retryCap: 2,
      cancellation: new CancellationRegistry(),
    });

    expect(vi.mocked(runPhase).mock.calls[0]![1].runId).toBe(active.id);
    const list = await runs.listRuns(t.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(active.id);
    expect(list[0]!.status).toBe("succeeded");
  });

  it("persists managed session paths for generic phases before dispatch", async () => {
    const cases = [
      { status: "executing" as const, phase: "code" as const, expected: "pi-session-code.jsonl" },
      { status: "verifying" as const, phase: "verify" as const, expected: "pi-session-verify.jsonl" },
      { status: "ready_to_ship" as const, phase: "pr" as const, expected: "pi-session-pr.jsonl" },
    ];

    for (const item of cases) {
      await resetTestStore(stateDir);
      vi.mocked(runPhase).mockReset();
      const task = await runs.createTask({ title: `managed-${item.phase}` });
      await runs.updateTask(task.id, { status: item.status, workflow: "backend-feature" });

      vi.mocked(runPhase).mockImplementation(async (_phase, input) => {
        const run = await runs.getRun(input.runId);
        expect(input.sessionFactory?.pathFor({ kind: "main" })).toBe(run.piSessionPath);
        expect(run.piSessionPath).toContain(item.expected);
        return {
          ok: true,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      });

      await runLoop({
        task: await runs.getTask(task.id),
        runs,
        events,
        phaseDeps: phaseDepsBase,
        worktrees,
        retryCap: 2,
        cancellation: new CancellationRegistry(),
      });

      expect(runPhase).toHaveBeenCalledWith(
        item.phase,
        expect.objectContaining({
          sessionFactory: expect.objectContaining({
            pathFor: expect.any(Function),
            open: expect.any(Function),
          }),
        }),
        expect.any(Object),
      );
    }
  });
});
