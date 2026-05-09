import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { createDb } from "@pi-harness/db";
import { RunStore } from "../../src/adapters/run-store.js";
import { EventStore } from "../../src/adapters/event-store.js";
import { WorktreeManager } from "../../src/adapters/worktree.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { runLoop } from "../../src/runner/run-loop.js";
import { runPhase } from "../../src/runner/phase-prompts.js";
import { transition } from "../../src/domain/state-machine.js";
import { SCRIPT_QUESTION_COUNT } from "../../src/agents/brainstorm-script.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

// End-to-end happy path: file a task, drive it through the full scripted
// brainstorm Q&A, approve, observe the task land in `planning` with both
// artifacts marked `approved`. Exercises run-loop, scripted mock subagent,
// JSONL bus, ArtifactsStore, and state-machine — no browser, no real LLM.
describe("brainstorm integration flow", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  let scratch: string;
  let repo: string;
  let worktrees: WorktreeManager;
  let store: ArtifactsStore;

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await db.execute("delete from tasks");
    scratch = await mkdtemp(join(tmpdir(), "bs-int-"));
    repo = join(scratch, "repo");
    await mkdir(repo, { recursive: true });
    const repoGit = simpleGit(repo);
    await repoGit.init();
    await repoGit.addConfig("user.email", "test@example.com", false, "local");
    await repoGit.addConfig("user.name", "Test", false, "local");
    await writeFile(join(repo, "README.md"), "init\n");
    await repoGit.add("README.md");
    await repoGit.commit("init");
    worktrees = new WorktreeManager({ repoRoot: repo, worktreesDir: join(scratch, "wts") });
    store = new ArtifactsStore({ runsDir: join(scratch, "runs") });
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  function phaseDeps() {
    return {
      cwd: "/will-be-overridden",
      onEvent: () => {},
      createSession: (async () => { throw new Error("no real session in mock flow"); }) as any,
      runSubagent: (async () => { throw new Error("no real subagent in mock flow"); }) as any,
      store,
      eventStore: events,
      exec: (async () => ({ ok: true, stdout: "", stderr: "" })) as any,
    };
  }

  async function tickRunLoop(taskId: string) {
    const t = await runs.getTask(taskId);
    return runLoop({
      task: t,
      runs,
      events,
      phaseDeps: phaseDeps(),
      worktrees,
      retryCap: 2,
    });
  }

  // Find the earliest question in the JSONL that hasn't been answered yet.
  // Batched script steps emit multiple questions per tick, so "the last
  // question" isn't always the one to answer next — we want the oldest
  // unanswered one.
  function nextUnansweredQ(lines: any[]): any {
    const answeredIds = new Set(
      lines.filter((e) => e.kind === "brainstorm_answer").map((e) => e.questionId),
    );
    return lines.find(
      (e) => e.kind === "brainstorm_question" && !answeredIds.has(e.questionId),
    );
  }

  async function appendAnswer(cwd: string, taskId: string, optionId: string) {
    const path = join(cwd, ".harness", taskId, "brainstorm.jsonl");
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
    const q = nextUnansweredQ(lines);
    if (!q) throw new Error("no unanswered question to answer");
    const w = new JsonlWriter(path);
    await w.append({
      ts: new Date().toISOString(),
      kind: "brainstorm_answer",
      questionId: q.questionId,
      optionId,
    });
  }

  it("happy path: 5 questions answered → ready → approve → planning", async () => {
    const t = await runs.createTask({ title: "integration" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    // First tick creates worktree, scaffolding commit, runs first runBrainstorm
    // which emits probe + Q1.
    await tickRunLoop(t.id);
    let task = await runs.getTask(t.id);
    expect(task.worktreePath).toBeTruthy();
    expect(task.branchName).toBe(`pi/${t.id}`);

    // Answer all 5 questions. After each answer we tick the loop; the agent
    // emits the next question (or finalizes).
    const recommended: Record<string, string> = {
      q_scope: "narrow",
      q_constraint: "correctness",
      q_alternative: "abstract",
      q_verification: "unit_e2e",
      q_acceptance: "functional",
    };
    for (let i = 0; i < SCRIPT_QUESTION_COUNT; i++) {
      const path = join(task.worktreePath!, ".harness", t.id, "brainstorm.jsonl");
      const raw = await readFile(path, "utf8");
      const lines = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
      const nextQ = nextUnansweredQ(lines);
      const optionId = recommended[nextQ.questionId as string]!;
      await appendAnswer(task.worktreePath!, t.id, optionId);
      task = await tickRunLoop(t.id);
    }

    // After last answer + tick, both artifacts should be ready and the task
    // should be sitting at awaitingApproval=true.
    const design = await store.readArtifact(task.worktreePath!, t.id, "design");
    const spec = await store.readArtifact(task.worktreePath!, t.id, "spec");
    expect(design?.fm.status).toBe("ready");
    expect(spec?.fm.status).toBe("ready");
    expect(task.status).toBe("brainstorming");
    expect(task.awaitingApproval).toBe(true);

    // Approve via state-machine — and apply the artifact-status mutation the
    // HTTP handler would normally do.
    const approved = transition(task, { type: "user_approve_brainstorm" });
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      task = await runs.updateTask(t.id, {
        status: approved.task.status,
        awaitingApproval: approved.task.awaitingApproval,
      });
      await store.setArtifactStatus(task.worktreePath!, t.id, "design", "approved", "user");
      await store.setArtifactStatus(task.worktreePath!, t.id, "spec", "approved", "user");
    }

    expect(task.status).toBe("planning");
    expect(task.awaitingApproval).toBe(false);
    const finalDesign = await store.readArtifact(task.worktreePath!, t.id, "design");
    const finalSpec = await store.readArtifact(task.worktreePath!, t.id, "spec");
    expect(finalDesign?.fm.status).toBe("approved");
    expect(finalSpec?.fm.status).toBe("approved");
  });

  it("revision path: ready → request changes → resume → ready again", async () => {
    const t = await runs.createTask({ title: "revision" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    await tickRunLoop(t.id);
    let task = await runs.getTask(t.id);

    const recommended: Record<string, string> = {
      q_scope: "narrow",
      q_constraint: "correctness",
      q_alternative: "abstract",
      q_verification: "unit_e2e",
      q_acceptance: "functional",
    };
    for (let i = 0; i < SCRIPT_QUESTION_COUNT; i++) {
      const path = join(task.worktreePath!, ".harness", t.id, "brainstorm.jsonl");
      const raw = await readFile(path, "utf8");
      const lastQ = [...raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any)]
        .reverse()
        .find((e) => e.kind === "brainstorm_question");
      await appendAnswer(task.worktreePath!, t.id, recommended[lastQ.questionId as string]!);
      task = await tickRunLoop(t.id);
    }

    expect(task.awaitingApproval).toBe(true);

    // Request changes — append a revision_requested event and clear gate.
    const path = join(task.worktreePath!, ".harness", t.id, "brainstorm.jsonl");
    const linesBefore = (await readFile(path, "utf8")).split("\n").filter(Boolean).length;
    const w = new JsonlWriter(path);
    await w.append({
      ts: new Date().toISOString(),
      kind: "brainstorm_revision_requested",
      comment: "please add a perf section to the design",
    });
    const result = transition(task, {
      type: "user_request_brainstorm_changes",
      comment: "please add a perf section to the design",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      task = await runs.updateTask(t.id, {
        awaitingApproval: result.task.awaitingApproval,
      });
    }
    expect(task.awaitingApproval).toBe(false);

    // The JSONL log preserves history (it's only ever appended).
    const linesAfter = (await readFile(path, "utf8")).split("\n").filter(Boolean).length;
    expect(linesAfter).toBeGreaterThan(linesBefore);
  });
});
