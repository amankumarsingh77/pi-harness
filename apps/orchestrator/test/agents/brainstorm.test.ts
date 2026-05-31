import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  appendFile,
} from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import {
  __resetAuthCache,
  createAgentSession,
  type AgentSessionEvent,
} from "@pi-harness/pi-bridge";
import { createFakeAdapter, type FakeAgentSdkAdapter } from "@pi-harness/pi-bridge/_test/fake-sdk";
import type { PhaseModelConfig } from "@pi-harness/shared";
import { runBrainstorm } from "../../src/agents/brainstorm.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { BrainstormEventBus } from "../../src/agents/brainstorm-event-bus.js";
import { scaffoldBrainstorm } from "../../src/runner/scaffold-brainstorm.js";

const PHASE_MODEL: PhaseModelConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  thinkingLevel: "medium",
};

let scratch: string;
let envDir: string;
let prevCwd: string;
const TASK = "T-1";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bs-agent-"));
  await mkdir(scratch, { recursive: true });
  const git = simpleGit(scratch);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(scratch, "README.md"), "init\n");
  await git.add("README.md");
  await git.commit("init");
  await git.checkoutLocalBranch(`pi/${TASK}`);

  envDir = await mkdtemp(join(tmpdir(), "bs-env-"));
  prevCwd = process.cwd();
  process.chdir(envDir);
  writeFileSync(join(envDir, ".env.harness"), "ANTHROPIC_API_KEY=test-key\n");
  __resetAuthCache();

  await scaffoldBrainstorm({ cwd: scratch, taskId: TASK, branch: `pi/${TASK}` });
});

afterEach(async () => {
  process.chdir(prevCwd);
  await rm(scratch, { recursive: true, force: true });
  await rm(envDir, { recursive: true, force: true });
  __resetAuthCache();
});

function makeFakes() {
  const eventStoreAppends: unknown[] = [];
  const eventStore = {
    append: vi.fn(async (e: unknown) => {
      eventStoreAppends.push(e);
    }),
  };
  return { eventStore, eventStoreAppends };
}

function makeBus(eventStore: { append: (e: unknown) => Promise<void> }) {
  const jsonl = new JsonlWriter(join(scratch, ".harness", TASK, "brainstorm.jsonl"));
  return new BrainstormEventBus({
    eventStore: eventStore as never,
    jsonl,
    runId: "r1",
    taskId: TASK,
  });
}

function sessionPath(): string {
  return join(scratch, ".harness", TASK, "pi-session.jsonl");
}

// Wires the fake SDK adapter into a createAgentSession factory the brainstorm
// agent can call. Returns the adapter so the test can drive the SDK event
// stream directly.
function wireAgentSession(adapter: FakeAgentSdkAdapter) {
  return (opts: Parameters<typeof createAgentSession>[0]) =>
    createAgentSession(opts, adapter);
}

type CustomToolForTest = {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: never,
  ) => Promise<unknown>;
};

function customTools(adapter: FakeAgentSdkAdapter): CustomToolForTest[] {
  return (adapter.state.createOpts?.customTools ?? []) as CustomToolForTest[];
}

function findCustomTool(adapter: FakeAgentSdkAdapter, name: string): CustomToolForTest {
  const tool = customTools(adapter).find((t) => t.name === name);
  if (!tool) throw new Error(`${name} tool not registered with adapter`);
  return tool;
}

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

// Drive the fake SDK end-to-end for a "submit_questions" turn: wait for the
// orchestrator to call session.prompt(), invoke the customTool's execute fn
// (so the bus gets the brainstorm_question events), then emit tool_call /
// tool_result / agent_end so the bridge resolves the prompt promise.
// Yield until the bridge has called sdkSession.prompt (i.e. promptCalls is
// populated). The bridge's prompt() awaits sdkSession.prompt before returning
// the in-flight promise, so this guarantees inFlight is registered when we
// next emit agent_end.
async function waitForPrompt(adapter: FakeAgentSdkAdapter): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (adapter.state.promptCalls.length > 0) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error("bridge never called sdkSession.prompt");
}

async function waitForPromptCount(adapter: FakeAgentSdkAdapter, count: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (adapter.state.promptCalls.length >= count) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`bridge never reached ${count} prompt calls`);
}

async function driveSubmitQuestions(
  adapter: FakeAgentSdkAdapter,
  questions: { questionId: string; prompt: string; options: { id: string; label: string; recommended: boolean; evidence: string[] }[]; sectionTarget: { artifact: "design" | "spec"; section: string } }[],
): Promise<void> {
  await waitForPrompt(adapter);
  const submit = findCustomTool(adapter, "submit_questions");
  const result = await submit.execute(
    "tc1",
    { questions },
    undefined,
    undefined,
    undefined as never,
  );
  adapter.emit({ type: "tool_execution_start", toolName: "submit_questions", args: { questions } } as AgentSessionEvent);
  adapter.emit({
    type: "tool_execution_end",
    toolName: "submit_questions",
    isError: false,
    result,
  } as AgentSessionEvent);
  adapter.emit({
    type: "agent_end",
    messages: [assistantWithUsage(10, 5, 0.001)],
  } as AgentSessionEvent);
}

async function driveMarkReady(adapter: FakeAgentSdkAdapter): Promise<void> {
  await waitForPrompt(adapter);
  const ready = findCustomTool(adapter, "mark_ready");
  const result = await ready.execute("tc2", {}, undefined, undefined, undefined as never);
  adapter.emit({ type: "tool_execution_start", toolName: "mark_ready", args: {} } as AgentSessionEvent);
  adapter.emit({
    type: "tool_execution_end",
    toolName: "mark_ready",
    isError: false,
    result,
  } as AgentSessionEvent);
  adapter.emit({
    type: "agent_end",
    messages: [assistantWithUsage(8, 3, 0.0005)],
  } as AgentSessionEvent);
}

describe("runBrainstorm (real-bridge)", () => {
  it("initial tick: empty JSONL → bridge prompted; questions published; halts", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const adapter = createFakeAdapter();

    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
      ticketTitle: "Add login",
      ticketDescription: "we need oauth",
    });

    await driveSubmitQuestions(adapter, [
      {
        questionId: "q-scope",
        prompt: "Pick a scope",
        options: [
          { id: "narrow", label: "Narrow", recommended: true, evidence: [] },
          { id: "wide", label: "Wide", recommended: false, evidence: [] },
        ],
        sectionTarget: { artifact: "design", section: "Goals" },
      },
    ]);

    const r = await promise;
    expect(r.ok).toBe(true);
    expect(r.ready).toBe(false);
    expect(r.costUsd).toBeCloseTo(0.001, 6);

    // Bridge was prompted with the initial prompt body.
    expect(adapter.state.promptCalls).toHaveLength(1);
    expect(adapter.state.promptCalls[0]!.text).toContain("Begin brainstorming");
    expect(adapter.state.promptCalls[0]!.text).toContain("Title: Add login");
    expect(adapter.state.promptCalls[0]!.text).toContain(`.harness/${TASK}/design.md`);
    const toolNames = (adapter.state.createOpts?.customTools ?? []).map((t) => t.name);
    expect(adapter.state.createOpts?.tools).toContain("read");
    expect(adapter.state.createOpts?.tools).not.toContain("write");
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "read_artifact",
        "write_artifact",
        "submit_questions",
        "submit_mocks",
        "submit_mock_revision",
        "mark_ready",
        "reply_to_user",
        "pi_web_search",
        "pi_web_fetch",
      ]),
    );

    const jsonl = await readFile(
      join(scratch, ".harness", TASK, "brainstorm.jsonl"),
      "utf8",
    );
    const events = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.filter((e) => e.kind === "brainstorm_question")).toHaveLength(1);
  });

  it("initial tick: library task runs web research before brainstorm and forwards subagent tool logs", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore, eventStoreAppends } = makeFakes();
    const bus = makeBus(eventStore);
    const adapter = createFakeAdapter();

    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
      ticketTitle: "Compare auth libraries",
      ticketDescription: "Research current OAuth library alternatives",
    });

    await waitForPromptCount(adapter, 1);
    const researchTools = (adapter.state.createOpts?.customTools ?? []) as Array<{
      name: string;
      execute: (
        id: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: never,
      ) => Promise<unknown>;
    }>;
    const writeFindings = researchTools.find((t) => t.name === "write_findings");
    if (!writeFindings) throw new Error("write_findings tool not registered");

    adapter.emit({
      type: "tool_execution_start",
      toolName: "pi_web_search",
      args: { query: "oauth libraries node" },
    } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolName: "pi_web_search",
      isError: false,
      result: {
        details: {
          ok: true,
          provider: "searxng",
          providerUrl: "http://localhost:8888",
          query: "oauth libraries node",
          results: [{ title: "OAuth", url: "https://example.com", snippet: "", source: "test" }],
        },
      },
    } as AgentSessionEvent);
    await writeFindings.execute(
      "wf1",
      { body: "## Summary\nUse library A.\n\n## Sources\n- https://example.com" },
      undefined,
      undefined,
      undefined as never,
    );
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(4, 4, 0.0002)],
    } as AgentSessionEvent);

    await waitForPromptCount(adapter, 2);
    expect(adapter.state.promptCalls[1]!.text).toContain("Research digest");
    expect(adapter.state.promptCalls[1]!.text).toContain("Use library A");

    await driveSubmitQuestions(adapter, [
      {
        questionId: "q-library",
        prompt: "Pick a library",
        options: [
          { id: "a", label: "Library A", recommended: true, evidence: ["https://example.com"] },
          { id: "b", label: "Library B", recommended: false, evidence: [] },
        ],
        sectionTarget: { artifact: "design", section: "External research" },
      },
    ]);

    const r = await promise;
    expect(r.ok).toBe(true);
    expect(eventStoreAppends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          tool: "pi_web_search",
          subagent: "web-search-researcher",
        }),
        expect.objectContaining({
          kind: "tool_result",
          tool: "pi_web_search",
          subagent: "web-search-researcher",
        }),
      ]),
    );
  });

  it("answers delta: prompt contains every new answer", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    // Seed JSONL: a question batch followed by user answers.
    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q-scope", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t2", kind: "brainstorm_question", questionId: "q-auth", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t3", kind: "brainstorm_answer", questionId: "q-scope", optionId: "narrow" },
      { ts: "t4", kind: "brainstorm_answer", questionId: "q-auth", optionId: "oauth" },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    // Drive a turn that ends naturally (no tool call). The orchestrator will
    // still resolve once agent_end fires.
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);

    await promise;

    const text = adapter.state.promptCalls[0]!.text;
    expect(text).toContain("User answered");
    expect(text).toContain("q-scope: narrow");
    expect(text).toContain("q-auth: oauth");
    expect(text).toContain("Continue.");
  });

  it("revision: prompt carries the revision comment", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q-scope", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t2", kind: "brainstorm_revision_requested", comment: "add a perf section" },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    expect(adapter.state.promptCalls[0]!.text).toContain("add a perf section");
    expect(adapter.state.promptCalls[0]!.text).toContain("User requested revisions");
  });

  it("revision: ready status before the request does not suppress the revision turn", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      {
        ts: "t1",
        kind: "brainstorm_system",
        systemKind: "status_changed",
        data: { status: "ready" },
      },
      {
        ts: "t2",
        kind: "brainstorm_revision_requested",
        comment: "add another mock direction",
      },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    expect(adapter.state.promptCalls[0]!.text).toContain("add another mock direction");
    expect(adapter.state.promptCalls[0]!.text).toContain("User requested revisions");
  });

  it("mock selection: prompt carries the selected mock id", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    await writeFile(
      jsonlPath,
      [
        JSON.stringify({
          ts: "t1",
          kind: "brainstorm_mock_proposed",
          mock: {
            mockId: "mock-a",
            title: "A",
            summary: "A",
            recommended: true,
            createdAt: "t1",
            pages: [
              {
                pageId: "task-detail",
                title: "Task detail",
                htmlPath: ".harness/T-1/mocks/mock-a/task-detail.html",
              },
            ],
          },
        }),
        JSON.stringify({ ts: "t2", kind: "brainstorm_mock_selected", mockId: "mock-a" }),
      ].join("\n") + "\n",
    );
    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    expect(adapter.state.promptCalls[0]!.text).toContain("User selected UI mock: mock-a");
  });

  it("mock edit request: prompt carries the edit request", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    await writeFile(
      jsonlPath,
      [
        JSON.stringify({
          ts: "t1",
          kind: "brainstorm_mock_proposed",
          mock: {
            mockId: "mock-a",
            title: "A",
            summary: "A",
            recommended: true,
            createdAt: "t1",
            pages: [
              {
                pageId: "task-detail",
                title: "Task detail",
                htmlPath: ".harness/T-1/mocks/mock-a/task-detail.html",
              },
            ],
          },
        }),
        JSON.stringify({
          ts: "t2",
          kind: "brainstorm_mock_edit_requested",
          requestId: "mer_1",
          mockId: "mock-a",
          comment: "Make it denser.",
        }),
      ].join("\n") + "\n",
    );
    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    expect(adapter.state.promptCalls[0]!.text).toContain("User requested mock edit");
    expect(adapter.state.promptCalls[0]!.text).toContain("mer_1");
    expect(adapter.state.promptCalls[0]!.text).toContain("Make it denser.");
  });

  it("no-op: no new events since last agent activity → no bridge call", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q-scope", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const r = await runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    expect(r.ok).toBe(true);
    expect(r.ready).toBe(false);
    expect(adapter.state.promptCalls).toHaveLength(0);
    expect(adapter.state.createOpts).toBeNull();
  });

  it("ready: mark_ready accepted → both artifacts ready, ready=true", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    // Pre-fill the artifacts so mark_ready's section check passes.
    const designArt = await store.readArtifact(scratch, TASK, "design");
    const specArt = await store.readArtifact(scratch, TASK, "spec");
    if (!designArt || !specArt) throw new Error("scaffolding missing");
    await store.writeArtifact(scratch, TASK, {
      fm: designArt.fm,
      body: "## Goals\nbuild login\n\n## Trade-offs\nslower release\n\n## Alternatives considered\nrolled own\n",
    });
    await store.writeArtifact(scratch, TASK, {
      fm: specArt.fm,
      body: "## Verification scenarios\nlog in via oauth\n\n## Acceptance criteria\nuser session set\n",
    });

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    await driveMarkReady(adapter);

    const r = await promise;
    expect(r.ok).toBe(true);
    expect(r.ready).toBe(true);

    const design = await store.readArtifact(scratch, TASK, "design");
    const spec = await store.readArtifact(scratch, TASK, "spec");
    expect(design?.fm.status).toBe("ready");
    expect(spec?.fm.status).toBe("ready");
  });

  it("scoped artifact tools write the worktree artifacts and preserve frontmatter", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const adapter = createFakeAdapter();

    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    await waitForPrompt(adapter);
    const writeArtifact = findCustomTool(adapter, "write_artifact");
    const readArtifact = findCustomTool(adapter, "read_artifact");
    const designBody = "## Goals\nbuild login\n\n## Trade-offs\nslower release\n\n## Alternatives considered\nrolled own\n";
    const specBody = "## Verification scenarios\nlog in via oauth\n\n## Acceptance criteria\nuser session set\n";

    const designWrite = await writeArtifact.execute(
      "wa1",
      { kind: "design", body: designBody },
      undefined,
      undefined,
      undefined as never,
    );
    const specWrite = await writeArtifact.execute(
      "wa2",
      { kind: "spec", body: specBody },
      undefined,
      undefined,
      undefined as never,
    );
    const designRead = await readArtifact.execute(
      "ra1",
      { kind: "design" },
      undefined,
      undefined,
      undefined as never,
    );

    adapter.emit({ type: "tool_execution_start", toolName: "write_artifact", args: { kind: "design" } } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolName: "write_artifact",
      isError: false,
      result: designWrite,
    } as AgentSessionEvent);
    adapter.emit({ type: "tool_execution_start", toolName: "write_artifact", args: { kind: "spec" } } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolName: "write_artifact",
      isError: false,
      result: specWrite,
    } as AgentSessionEvent);
    await driveMarkReady(adapter);

    const r = await promise;
    expect(r.ok).toBe(true);
    expect(r.ready).toBe(true);
    expect(designRead).toMatchObject({
      content: [{ type: "text", text: designBody }],
      details: expect.objectContaining({ kind: "design", status: "draft" }),
    });

    const design = await store.readArtifact(scratch, TASK, "design");
    const spec = await store.readArtifact(scratch, TASK, "spec");
    expect(design?.fm.kind).toBe("design");
    expect(design?.fm.status).toBe("ready");
    expect(design?.body).toBe(designBody);
    expect(spec?.fm.kind).toBe("spec");
    expect(spec?.fm.status).toBe("ready");
    expect(spec?.body).toBe(specBody);
  });

  it("write_artifact rejects pasted full artifacts with YAML frontmatter", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const adapter = createFakeAdapter();

    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    await waitForPrompt(adapter);
    const writeArtifact = findCustomTool(adapter, "write_artifact");
    const result = await writeArtifact.execute(
      "wa1",
      { kind: "design", body: "---\nstatus: draft\n---\n\n## Goals\nx\n" },
      undefined,
      undefined,
      undefined as never,
    );
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);

    const r = await promise;
    expect(r.ok).toBe(false);
    expect(result).toMatchObject({
      details: { ok: false, kind: "design" },
    });
  });

  it("resume: same sessionPath threaded into the SDK across ticks", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const adapter1 = createFakeAdapter();
    const p1 = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter1),
    });
    await driveSubmitQuestions(adapter1, [
      {
        questionId: "q1",
        prompt: "?",
        options: [
          { id: "a", label: "A", recommended: true, evidence: [] },
          { id: "b", label: "B", recommended: false, evidence: [] },
        ],
        sectionTarget: { artifact: "design", section: "Goals" },
      },
    ]);
    await p1;
    expect(adapter1.state.createOpts?.sessionPath).toBe(sessionPath());

    // Simulate user answer + restart: next runBrainstorm gets a fresh adapter.
    await appendFile(
      join(scratch, ".harness", TASK, "brainstorm.jsonl"),
      JSON.stringify({ ts: "t-after", kind: "brainstorm_answer", questionId: "q1", optionId: "a" }) + "\n",
    );

    const adapter2 = createFakeAdapter();
    const p2 = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter2),
    });
    await waitForPrompt(adapter2);
    adapter2.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await p2;
    expect(adapter2.state.createOpts?.sessionPath).toBe(sessionPath());
  });

  it("legacy maxTurns override does not hide a non-progress turn", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const adapter = createFakeAdapter();
    const legacyPhaseModel = { ...PHASE_MODEL, maxTurns: 1 };
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: legacyPhaseModel,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    // Historical configs may still include maxTurns, but turn count must not
    // block the agent anymore.
    adapter.emit({ type: "turn_start" } as AgentSessionEvent);
    adapter.emit({ type: "turn_start" } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);

    const r = await promise;
    expect(r.ok).toBe(false);
    expect(r.error).toBe("brainstorm: agent ended turn without questions or ready");
  });

  it("AuthError → ok:false with provider-tagged error and phase_blocked event", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    // Wipe the env so getApiKey throws AuthError on session creation.
    writeFileSync(join(envDir, ".env.harness"), "");
    __resetAuthCache();
    const prevKey = process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];

    try {
      const adapter = createFakeAdapter();
      const r = await runBrainstorm({
        taskId: TASK,
        runId: "r1",
        cwd: scratch,
        store,
        bus,
        eventStore: eventStore as never,
        phaseModel: PHASE_MODEL,
        sessionPath: sessionPath(),
        createAgentSession: wireAgentSession(adapter),
      });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("missing API key for anthropic");
      expect(adapter.state.createOpts).toBeNull();

      const jsonl = await readFile(
        join(scratch, ".harness", TASK, "brainstorm.jsonl"),
        "utf8",
      );
      const events = jsonl
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const blocked = events.find(
        (e) => e.kind === "brainstorm_system" && e["systemKind"] === "blocked",
      );
      expect(blocked).toBeDefined();
      expect((blocked!["data"] as { reason?: string }).reason).toMatch(/missing API key/i);
    } finally {
      if (prevKey !== undefined) process.env["ANTHROPIC_API_KEY"] = prevKey;
    }
  });

  it("corrupted pi-session.jsonl → file deleted + retry without sessionPath succeeds", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    // Pre-create a non-empty session file the adapter will reject on first try.
    await writeFile(sessionPath(), "{garbage\n");

    let attempt = 0;
    const adapter: FakeAgentSdkAdapter = createFakeAdapter();
    const original = adapter.create;
    adapter.create = async (createOpts) => {
      attempt += 1;
      if (attempt === 1) throw new Error("SessionManager.open: invalid jsonl");
      return original(createOpts);
    };

    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    // Wait for the failed-then-retried call to register createOpts.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await driveSubmitQuestions(adapter, [
      {
        questionId: "q-after-reset",
        prompt: "?",
        options: [
          { id: "a", label: "A", recommended: true, evidence: [] },
          { id: "b", label: "B", recommended: false, evidence: [] },
        ],
        sectionTarget: { artifact: "design", section: "Goals" },
      },
    ]);

    const r = await promise;
    expect(r.ok).toBe(true);
    expect(attempt).toBe(2);
    // Retry path passes no sessionPath so the bridge re-inits in-memory.
    expect(adapter.state.createOpts?.sessionPath).toBeUndefined();
    // Corrupted file was removed.
    expect(existsSync(sessionPath())).toBe(false);

    const jsonl = await readFile(
      join(scratch, ".harness", TASK, "brainstorm.jsonl"),
      "utf8",
    );
    expect(jsonl).toContain("session_reset");
  });

  it("status_changed=ready short-circuits subsequent ticks", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    await writeFile(
      jsonlPath,
      JSON.stringify({
        ts: "t1",
        kind: "brainstorm_system",
        systemKind: "status_changed",
        data: { status: "ready" },
      }) + "\n",
    );

    const adapter = createFakeAdapter();
    const r = await runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    expect(r.ok).toBe(true);
    expect(r.ready).toBe(true);
    expect(adapter.state.createOpts).toBeNull();
  });

  it("nudge: unconsumed nudge after answers folds into prompt and is marked consumed", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q-scope", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t2", kind: "brainstorm_answer", questionId: "q-scope", optionId: "narrow" },
      { ts: "t3", kind: "brainstorm_user_nudge", nudgeId: "n1", comment: "ignore the auth angle, deprecated", consumed: false },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    const text = adapter.state.promptCalls[0]!.text;
    expect(text).toContain("Recent user input");
    expect(text).toContain("ignore the auth angle, deprecated");
    expect(text).toContain("User answered");

    // Nudge republished with consumed:true.
    const jsonl = await readFile(jsonlPath, "utf8");
    const events = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const consumedEvents = events.filter(
      (e) => e.kind === "brainstorm_user_nudge" && e["nudgeId"] === "n1" && e["consumed"] === true,
    );
    expect(consumedEvents).toHaveLength(1);
  });

  it("nudge: alone in JSONL (no answer/revision) is sufficient to trigger a turn", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q-scope", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t2", kind: "brainstorm_user_nudge", nudgeId: "n1", comment: "focus on backend only", consumed: false },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    const text = adapter.state.promptCalls[0]!.text;
    expect(text).toContain("Recent user input");
    expect(text).toContain("focus on backend only");
  });

  it("nudge: already-consumed nudge is not re-folded", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    // The same nudgeId appears twice: first unconsumed, then a consumed
    // replacement. The latest event for the id wins.
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q1", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t2", kind: "brainstorm_user_nudge", nudgeId: "n1", comment: "first nudge", consumed: false },
      { ts: "t3", kind: "brainstorm_user_nudge", nudgeId: "n1", comment: "first nudge", consumed: true },
      { ts: "t4", kind: "brainstorm_answer", questionId: "q1", optionId: "a" },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    const text = adapter.state.promptCalls[0]!.text;
    expect(text).not.toContain("Recent user input");
    expect(text).not.toContain("first nudge");
    expect(text).toContain("User answered");
  });

  it("usage: emits brainstorm_usage with cumulative arithmetic across ticks", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const adapter = createFakeAdapter();

    // Tick 1: empty JSONL → initial. Drive a submit_questions turn that
    // reports usage of (10 in, 5 out, $0.001).
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
      ticketTitle: "x",
      ticketDescription: "y",
    });
    await driveSubmitQuestions(adapter, [
      {
        questionId: "q1",
        prompt: "?",
        options: [
          { id: "a", label: "A", recommended: true, evidence: [] },
          { id: "b", label: "B", recommended: false, evidence: [] },
        ],
        sectionTarget: { artifact: "design", section: "Goals" },
      },
    ]);
    await promise;

    const events1 = (await readFile(
      join(scratch, ".harness", TASK, "brainstorm.jsonl"),
      "utf8",
    ))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const usage1 = events1.filter((e) => e.kind === "brainstorm_usage");
    expect(usage1).toHaveLength(1);
    expect(usage1[0]).toMatchObject({
      tickIndex: 0,
      inputTokens: 10,
      outputTokens: 5,
      cumulativeInputTokens: 10,
      cumulativeOutputTokens: 5,
    });
    expect(usage1[0]!["costUsd"]).toBeCloseTo(0.001, 6);
    expect(usage1[0]!["cumulativeCostUsd"]).toBeCloseTo(0.001, 6);

    // Tick 2: append an answer + drive another turn with usage (3, 2, 0.0005).
    // Cumulative should be (13, 7, 0.0015).
    await appendFile(
      join(scratch, ".harness", TASK, "brainstorm.jsonl"),
      JSON.stringify({ ts: "t-after", kind: "brainstorm_answer", questionId: "q1", optionId: "a" }) + "\n",
    );
    const adapter2 = createFakeAdapter();
    const p2 = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter2),
    });
    await waitForPrompt(adapter2);
    adapter2.emit({
      type: "agent_end",
      messages: [assistantWithUsage(3, 2, 0.0005)],
    } as AgentSessionEvent);
    await p2;

    const events2 = (await readFile(
      join(scratch, ".harness", TASK, "brainstorm.jsonl"),
      "utf8",
    ))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const usage2 = events2.filter((e) => e.kind === "brainstorm_usage");
    expect(usage2).toHaveLength(2);
    expect(usage2[1]).toMatchObject({
      tickIndex: 1,
      inputTokens: 3,
      outputTokens: 2,
      cumulativeInputTokens: 13,
      cumulativeOutputTokens: 7,
    });
    expect(usage2[1]!["cumulativeCostUsd"]).toBeCloseTo(0.0015, 6);
  });

  it("usage: zero-cost ticks do not emit a usage event", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    // Seed JSONL with a question already → decide() returns no-op when no
    // new answer/revision/nudge follows; runBrainstorm short-circuits before
    // calling the SDK, so no usage event.
    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    await writeFile(
      jsonlPath,
      JSON.stringify({ ts: "t1", kind: "brainstorm_question", questionId: "q1", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } }) + "\n",
    );

    const adapter = createFakeAdapter();
    await runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });

    const events = (await readFile(jsonlPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.filter((e) => e.kind === "brainstorm_usage")).toHaveLength(0);
  });

  it("nudge: multiple unconsumed nudges fold in arrival order", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);

    const jsonlPath = join(scratch, ".harness", TASK, "brainstorm.jsonl");
    const seed = [
      { ts: "t1", kind: "brainstorm_question", questionId: "q1", prompt: "?", options: [], sectionTarget: { artifact: "design", section: "Goals" } },
      { ts: "t2", kind: "brainstorm_user_nudge", nudgeId: "n1", comment: "first thing", consumed: false },
      { ts: "t3", kind: "brainstorm_user_nudge", nudgeId: "n2", comment: "second thing", consumed: false },
    ];
    await writeFile(jsonlPath, seed.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const adapter = createFakeAdapter();
    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
    });
    await waitForPrompt(adapter);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await promise;

    const text = adapter.state.promptCalls[0]!.text;
    const firstIdx = text.indexOf("first thing");
    const secondIdx = text.indexOf("second thing");
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it("signal aborted mid-prompt: returns cancelled, forwards abort to SDK", async () => {
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const bus = makeBus(eventStore);
    const adapter = createFakeAdapter();
    const controller = new AbortController();

    const promise = runBrainstorm({
      taskId: TASK,
      runId: "r1",
      cwd: scratch,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: PHASE_MODEL,
      sessionPath: sessionPath(),
      createAgentSession: wireAgentSession(adapter),
      ticketTitle: "x",
      ticketDescription: "y",
      signal: controller.signal,
    });

    // Wait until prompt() registers, then abort. The bridge's abort path
    // rejects the in-flight prompt with "aborted"; the driver translates
    // that into a cancelled BrainstormResult.
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    const r = await promise;
    expect(r.cancelled).toBe(true);
    expect(r.ok).toBe(false);
    expect(adapter.state.abortCalls).toBeGreaterThanOrEqual(1);
  });
});
