import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
  createAgentSession,
  __resetAuthCache,
  type AgentSessionEvent,
  type AgentSessionOptions,
} from "@pi-harness/pi-bridge";
import { createFakeAdapter, type FakeAgentSdkAdapter } from "@pi-harness/pi-bridge/_test/fake-sdk";
import { WorktreeManager } from "../../src/adapters/worktree.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { runLoop } from "../../src/runner/run-loop.js";
import { CancellationRegistry } from "../../src/runner/cancellation.js";
import { transition } from "../../src/domain/state-machine.js";
import { createBareTestStores, resetTestStore } from "../helpers/stores.js";

const VALID_READY_DESIGN_BODY = [
  "## Problem",
  "Brainstorm artifacts need enough detail for planning.",
  "",
  "## Context",
  "The brainstorm phase writes design.md and spec.md before approval.",
  "",
  "## Requirements",
  "- Functional: document the chosen approach and requirements.",
  "",
  "## Architectural Decisions",
  "- Use stable markdown headings for validation.",
  "",
  "## Approaches Considered",
  "- Continue using the minimal artifact format.",
  "",
  "## Data Shapes / Contracts",
  "- Artifacts remain markdown files with harness-owned frontmatter.",
  "",
  "## Architecture",
  "The agent writes artifacts through write_artifact and calls mark_ready.",
  "",
  "## External Dependencies & Fallback Chain",
  "None — pure-internal workflow change.",
  "",
  "## Risks & Mitigations",
  "- Risk: incomplete artifacts. Mitigation: mark_ready validates required sections.",
  "",
  "## Assumptions",
  "- The user approves artifacts before planning.",
  "",
  "## Open Questions",
  "None blocking.",
  "",
  "## What This Does NOT Do",
  "- Change the task approval API.",
  "",
].join("\n");

const VALID_READY_SPEC_BODY = [
  "## Glossary",
  "- Requirement: an observable condition the implementation must satisfy.",
  "",
  "## Requirements",
  "| ID | Type | Requirement | Acceptance Criterion | Priority |",
  "| --- | --- | --- | --- | --- |",
  "| REQ-001 | Event-driven | The system shall accept complete brainstorm artifacts. | Approval advances the task to planning. | Must |",
  "",
  "## Edge Cases",
  "| ID | Scenario | Expected Behavior | Derived From |",
  "| --- | --- | --- | --- |",
  "| EDGE-001 | Artifact has all required headings. | mark_ready succeeds. | REQ-001 |",
  "",
  "## Verification Matrix",
  "| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |",
  "| --- | --- | --- | --- | --- | --- |",
  "| REQ-001 | Yes | Yes | No | No | Integration flow covers phase transition. |",
  "",
  "## Verification scenarios",
  "- Complete brainstorm, approve it, and observe planning start.",
  "",
  "## Out of Scope",
  "- Browser-level dashboard approval coverage.",
  "",
].join("\n");

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
  const { stateDir, runs, events } = createBareTestStores();
  let scratch: string;
  let repo: string;
  let envDir: string;
  let prevCwd: string;
  let worktrees: WorktreeManager;
  let store: ArtifactsStore;
  let queue: ((adapter: FakeAgentSdkAdapter) => Promise<void>)[];
  let cancellationRegistry: CancellationRegistry;

  beforeEach(async () => {
    await resetTestStore(stateDir);
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
    await repoGit.raw(["branch", "-M", "main"]);
    worktrees = new WorktreeManager({ repoRoot: repo, worktreesDir: join(scratch, "wts") });
    store = new ArtifactsStore();

    envDir = await mkdtemp(join(tmpdir(), "bs-int-env-"));
    prevCwd = process.cwd();
    process.chdir(envDir);
    writeFileSync(
      join(envDir, ".env.harness"),
      "OPENCODE_API_KEY=test-key\nANTHROPIC_API_KEY=test-key\nCROFAI_API_KEY=test-key\n",
    );
    __resetAuthCache();
    queue = [];
    cancellationRegistry = new CancellationRegistry();
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
      cancellation: cancellationRegistry,
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
    adapter.emit({ type: "tool_execution_start", toolName: name, args: params } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolName: name,
      isError: false,
      result,
    } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(5, 3, 0.0001)],
    } as AgentSessionEvent);
  }

  it("happy path: ask questions → answer → mark_ready → approve → planning", async () => {
    const t = await runs.createTask({ title: "brainstorm happy path" });
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
        body: VALID_READY_DESIGN_BODY,
      });
      await store.writeArtifact(task.worktreePath!, t.id, {
        fm: specArt.fm,
        body: VALID_READY_SPEC_BODY,
      });
      await executeTool(adapter, "mark_ready", {});
    });

    task = await tickRunLoop(t.id);

    const design = await store.readArtifact(task.worktreePath!, t.id, "design");
    const spec = await store.readArtifact(task.worktreePath!, t.id, "spec");
    expect(design?.fm.status).toBe("ready");
    expect(spec?.fm.status).toBe("ready");
    expect(task.status).toBe("brainstorming");
    // Gate is derived from the worktree, not stored on the task.
    const { deriveBrainstormGate } = await import(
      "../../src/agents/brainstorm-gate.js"
    );
    expect(
      await deriveBrainstormGate(task.worktreePath!, t.id, store),
    ).toBe("awaiting_user");

    // Approve via the state-machine + artifact-status flip.
    const approved = transition(task, { type: "user_approve_brainstorm" });
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      task = await runs.updateTask(t.id, {
        status: approved.task.status,
      });
      await store.setArtifactStatus(task.worktreePath!, t.id, "design", "approved", "user");
      await store.setArtifactStatus(task.worktreePath!, t.id, "spec", "approved", "user");
    }

    expect(task.status).toBe("planning");

    // Single-run invariant: brainstorm reuses one Run row across all ticks
    // (so the dashboard's SSE subscription survives a request-changes
    // round-trip). This test bypasses the HTTP route on approve, so the
    // run is still `running` here. The route-level close path is covered by
    // http.test.ts (user_approve_brainstorm closes the active brainstorm
    // run + emits phase_ended).
    const finalRuns = await runs.listRuns(t.id);
    expect(finalRuns).toHaveLength(1);
    expect(finalRuns[0]!.phase).toBe("brainstorm");
    expect(finalRuns[0]!.status).toBe("running");

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

  it("nudge: free-form user input lands in the next prompt and is marked consumed", async () => {
    const t = await runs.createTask({ title: "nudge-int" });
    await runs.updateTask(t.id, { status: "brainstorming", workflow: "backend-feature" });

    // Turn 1: agent submits one question, then halts.
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
        ],
      });
    });

    await tickRunLoop(t.id);
    const task = await runs.getTask(t.id);
    expect(task.worktreePath).toBeTruthy();

    // Simulate the nudge endpoint appending a user nudge to JSONL.
    const jsonlPath = join(task.worktreePath!, ".harness", t.id, "brainstorm.jsonl");
    const w = new JsonlWriter(jsonlPath);
    await w.append({
      ts: new Date().toISOString(),
      kind: "brainstorm_user_nudge",
      nudgeId: "n_int_1",
      comment: "focus on backend only — ignore the UI angle",
      consumed: false,
    });

    // Turn 2: the run-loop ticks again. We capture the prompt sent to the
    // bridge to assert the nudge is folded in. The agent ends the turn
    // without a tool call.
    let capturedPromptText: string | null = null;
    queue.push(async (adapter) => {
      // Wait for prompt() to register before capturing the prompt body —
      // the driver fires immediately after createAgentSession resolves but
      // before sdkSession.prompt has been called.
      for (let i = 0; i < 100 && adapter.state.promptCalls.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 1));
      }
      capturedPromptText = adapter.state.promptCalls[0]?.text ?? null;
      adapter.emit({
        type: "agent_end",
        messages: [assistantWithUsage(2, 1, 0.0001)],
      } as AgentSessionEvent);
    });

    await tickRunLoop(t.id);

    expect(capturedPromptText).not.toBeNull();
    expect(capturedPromptText!).toContain("Recent user input");
    expect(capturedPromptText!).toContain("focus on backend only");

    // The nudge should now appear twice in JSONL: the original (consumed:false)
    // and a republished consumed:true entry. The consumed:true entry is the
    // signal for the dashboard's "agent saw this" indicator.
    const jsonlEvents = (await readFile(jsonlPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const nudges = jsonlEvents.filter((e) => e.kind === "brainstorm_user_nudge");
    expect(nudges).toHaveLength(2);
    expect(nudges[0]!["consumed"]).toBe(false);
    expect(nudges[1]!["consumed"]).toBe(true);
    expect(nudges[1]!["nudgeId"]).toBe("n_int_1");
  });
});
