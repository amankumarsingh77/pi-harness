import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { createDb } from "@pi-harness/db";
import {
  createAgentSession,
  __resetAuthCache,
  type AgentSdkEvent,
  type AgentSessionOptions,
} from "@pi-harness/pi-bridge";
import { createFakeAdapter, type FakeAgentSdkAdapter } from "@pi-harness/pi-bridge/_test/fake-sdk";
import { RunStore } from "../../src/adapters/run-store.js";
import { EventStore } from "../../src/adapters/event-store.js";
import { WorktreeManager } from "../../src/adapters/worktree.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { runLoop } from "../../src/runner/run-loop.js";
import { transition } from "../../src/domain/state-machine.js";

const url = process.env.DATABASE_URL ?? "postgresql://piharness:piharness@localhost:5433/piharness";

function assistantWithUsage(input: number, output: number, costTotal: number) {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    usage: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
    },
  };
}

// End-to-end happy path against the real bridge driven by a fake SDK adapter.
// The test scripts the agent's behavior turn-by-turn: the fake adapter is the
// boundary between "the harness" and "the LLM". This proves the dashboard's
// brainstorm event sequence is intact through the real run-loop + bridge.
describe("brainstorm integration flow", () => {
  const { db, client } = createDb(url);
  const runs = new RunStore(db);
  const events = new EventStore(db);
  let scratch: string;
  let repo: string;
  let envDir: string;
  let prevCwd: string;
  let worktrees: WorktreeManager;
  let store: ArtifactsStore;
  let queue: ((adapter: FakeAgentSdkAdapter) => Promise<void>)[];

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

    envDir = await mkdtemp(join(tmpdir(), "bs-int-env-"));
    prevCwd = process.cwd();
    process.chdir(envDir);
    writeFileSync(
      join(envDir, ".env.harness"),
      "OPENCODE_API_KEY=test-key\nANTHROPIC_API_KEY=test-key\n",
    );
    __resetAuthCache();
    queue = [];
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(scratch, { recursive: true, force: true });
    await rm(envDir, { recursive: true, force: true });
    __resetAuthCache();
  });

  // Wraps createAgentSession with a fake adapter and pulls the next scripted
  // turn-driver off `queue` to play out tool calls + agent_end.
  function makeCreateAgentSession() {
    return async (opts: AgentSessionOptions) => {
      const adapter = createFakeAdapter();
      const session = await createAgentSession(opts, adapter);
      const driver = queue.shift();
      if (!driver) throw new Error("no scripted turn driver enqueued");
      // Driver runs after prompt() registers the in-flight gate.
      void Promise.resolve().then(() => driver(adapter));
      return session;
    };
  }

  function phaseDeps() {
    return {
      cwd: "/will-be-overridden",
      onEvent: () => {},
      createAgentSession: makeCreateAgentSession(),
      store,
      eventStore: events,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  async function executeTool(adapter: FakeAgentSdkAdapter, name: string, params: unknown) {
    const tools = (adapter.state.createOpts?.customTools ?? []) as Array<{
      name: string;
      execute: (
        id: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: never,
      ) => Promise<unknown>;
    }>;
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    const result = await tool.execute("tc", params, undefined, undefined, undefined as never);
    adapter.emit({ type: "tool_execution_start", toolName: name, args: params } as AgentSdkEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolName: name,
      isError: false,
      result,
    } as AgentSdkEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(5, 3, 0.0001)],
    } as AgentSdkEvent);
  }

  it("happy path: ask questions → answer → mark_ready → approve → planning", async () => {
    const t = await runs.createTask({ title: "integration" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    // Turn 1: agent submits two questions, then halts.
    queue.push(async (adapter) => {
      await executeTool(adapter, "submit_questions", {
        questions: [
          {
            questionId: "q-scope",
            prompt: "What scope?",
            options: [
              { id: "narrow", label: "Narrow", recommended: true, evidence: [] },
              { id: "wide", label: "Wide", recommended: false, evidence: [] },
            ],
            sectionTarget: { artifact: "design", section: "Goals" },
          },
          {
            questionId: "q-auth",
            prompt: "Auth flow?",
            options: [
              { id: "oauth", label: "OAuth", recommended: true, evidence: [] },
              { id: "password", label: "Password", recommended: false, evidence: [] },
            ],
            sectionTarget: { artifact: "design", section: "Goals" },
          },
        ],
      });
    });

    await tickRunLoop(t.id);
    let task = await runs.getTask(t.id);
    expect(task.worktreePath).toBeTruthy();
    expect(task.branchName).toBe(`pi/${t.id}`);

    // Run row should now have the resumable session path persisted.
    const runsForTask = await runs.listRuns(t.id);
    expect(runsForTask).toHaveLength(1);
    expect(runsForTask[0]!.piSessionPath).toBe(
      join(task.worktreePath!, ".harness", t.id, "pi-session.jsonl"),
    );

    // User answers both questions.
    const jsonlPath = join(task.worktreePath!, ".harness", t.id, "brainstorm.jsonl");
    const w = new JsonlWriter(jsonlPath);
    await w.append({
      ts: new Date().toISOString(),
      kind: "brainstorm_answer",
      questionId: "q-scope",
      optionId: "narrow",
    });
    await w.append({
      ts: new Date().toISOString(),
      kind: "brainstorm_answer",
      questionId: "q-auth",
      optionId: "oauth",
    });

    // Turn 2: agent fills both artifacts, then mark_ready.
    queue.push(async (adapter) => {
      // Pre-fill artifacts directly; the harness's write tool would normally
      // do this, but we're driving the SDK boundary here.
      const designArt = await store.readArtifact(task.worktreePath!, t.id, "design");
      const specArt = await store.readArtifact(task.worktreePath!, t.id, "spec");
      if (!designArt || !specArt) throw new Error("missing scaffolding");
      await store.writeArtifact(task.worktreePath!, t.id, {
        fm: designArt.fm,
        body:
          "## Goals\nnarrow login flow\n\n## Trade-offs\nlonger build time\n\n## Alternatives considered\nbuilt our own oauth\n",
      });
      await store.writeArtifact(task.worktreePath!, t.id, {
        fm: specArt.fm,
        body:
          "## Verification scenarios\nuser logs in via oauth happy path\n\n## Acceptance criteria\nsession cookie present\n",
      });
      await executeTool(adapter, "mark_ready", {});
    });

    task = await tickRunLoop(t.id);

    const design = await store.readArtifact(task.worktreePath!, t.id, "design");
    const spec = await store.readArtifact(task.worktreePath!, t.id, "spec");
    expect(design?.fm.status).toBe("ready");
    expect(spec?.fm.status).toBe("ready");
    expect(task.status).toBe("brainstorming");
    expect(task.awaitingApproval).toBe(true);

    // Approve via the state-machine + artifact-status flip.
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

    // Dashboard contract: the JSONL records the canonical event sequence.
    const events = (await readFile(jsonlPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("brainstorm_question");
    expect(kinds).toContain("brainstorm_answer");
    const statusChanged = events.find(
      (e) =>
        e.kind === "brainstorm_system" &&
        (e["data"] as { status?: string } | undefined)?.status === "ready",
    );
    expect(statusChanged).toBeDefined();
  });
});
