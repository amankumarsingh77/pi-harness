import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../src/adapters/run-store.js";
import { EventStore } from "../src/adapters/event-store.js";
import { WorktreeManager } from "../src/adapters/worktree.js";

vi.mock("../src/runner/phase-prompts.js", () => ({
  runPhase: vi.fn(),
}));

import { runLoop } from "../src/runner/run-loop.js";
import { runPhase } from "../src/runner/phase-prompts.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

const phaseDepsBase: any = {
  cwd: "/tmp",
  onEvent: () => {},
  createSession: vi.fn(),
  runSubagent: vi.fn(),
  // Mocked runPhase doesn't actually use store, but run-loop reads artifacts
  // post-phase to compute the brainstorm gate. Stub the methods it touches.
  store: {
    readArtifact: vi.fn(async () => null),
  } as any,
  eventStore: { append: vi.fn(async () => {}) } as any,
  exec: vi.fn(),
};

describe("runLoop", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  let scratch: string;
  let repo: string;
  let worktrees: WorktreeManager;

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
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
    });

    // Mid-Q&A: stays in brainstorming, no gate yet.
    expect(after.status).toBe("brainstorming");
    expect(after.awaitingApproval).toBe(false);
    expect(runPhase).toHaveBeenCalledTimes(1);
  });

  it("brainstorm phase succeeded with both artifacts ready → awaitingApproval", async () => {
    const t = await runs.createTask({ title: "ready" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    const readyDeps = {
      ...phaseDepsBase,
      store: {
        readArtifact: vi.fn(async () => ({
          fm: { status: "ready" },
          body: "",
        })),
      },
    } as any;

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
    });

    expect(after.status).toBe("brainstorming");
    expect(after.awaitingApproval).toBe(true);
  });

  it("creates worktree + branch + scaffolding commit on brainstorm entry", async () => {
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

    // Scaffolding commit is on the branch
    const wtGit = simpleGit(after.worktreePath!);
    const log = await wtGit.log();
    expect(log.latest?.message).toContain("brainstorm scaffolding");
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
      }),
    ).resolves.toBeDefined();

    const list = await worktrees.list();
    expect(list.filter((w) => w.taskId === t.id)).toHaveLength(1);
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
    });

    expect(after.status).toBe("executing");
    expect(after.retryCount).toBe(1);
  });
});
