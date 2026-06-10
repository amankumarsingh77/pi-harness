import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import type { AgentEvent, Artifact, ExecutionDagNode } from "@pi-harness/shared";
import type { AgentSessionOptions, PromptUsage } from "@pi-harness/pi-bridge";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { runCode } from "../../src/agents/code.js";
import type { ManagedSessionFactory, ManagedSessionScope } from "../../src/runner/phase-session-manager.js";

class InMemoryEventStore {
  readonly events: AgentEvent[] = [];
  async append(event: AgentEvent): Promise<void> {
    this.events.push(event);
  }
}

type NodeBehavior = (node: ExecutionDagNode, opts: AgentSessionOptions) => Promise<void>;

let scratch: string;
let cwd: string;
let store: ArtifactsStore;
let eventStore: InMemoryEventStore;

const usage: PromptUsage = { inputTokens: 10, outputTokens: 5, costUsd: 0.01 };

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "code-runner-test-"));
  cwd = join(scratch, "repo");
  await mkdir(cwd, { recursive: true });
  const git = simpleGit(cwd);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(cwd, ".gitignore"), ".harness/\n");
  await writeFile(join(cwd, "README.md"), "init\n");
  await git.add(["README.md", ".gitignore"]);
  await git.commit("init");
  store = new ArtifactsStore();
  eventStore = new InMemoryEventStore();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("runCode", () => {
  it("starts independent parallel-safe nodes together and commits them serially", async () => {
    await writeDag([
      node({ id: "C-001", writes: ["src/a.ts"] }),
      node({ id: "C-002", writes: ["src/b.ts"] }),
    ]);
    let active = 0;
    let maxActive = 0;
    const starts: string[] = [];

    const result = await runCode({
      ...baseOpts(),
      createAgentSession: fakeCreateAgentSession(async (dagNode, opts) => {
        starts.push(dagNode.id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        await writeAssignedFiles(dagNode);
        opts.onEvent({ kind: "message_delta", text: "<coder-complete>" });
        active -= 1;
      }),
    });

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(maxActive).toBe(2);
    expect(starts.sort()).toEqual(["C-001", "C-002"]);
    const log = await simpleGit(cwd).log();
    expect(log.all.map((entry) => entry.message)).toEqual(
      expect.arrayContaining(["feat(code): complete C-001", "feat(code): complete C-002"]),
    );
  });

  it("preserves callId on forwarded tool_call and tool_result events", async () => {
    await writeDag([node({ id: "C-001", writes: ["src/a.ts"] })]);

    await runCode({
      ...baseOpts(),
      createAgentSession: fakeCreateAgentSession(async (dagNode, opts) => {
        opts.onEvent({ kind: "tool_call", callId: "call-xyz", tool: "read", input: { path: "src/a.ts" } });
        opts.onEvent({ kind: "tool_result", callId: "call-xyz", tool: "read", ok: true, output: "ok" });
        await writeAssignedFiles(dagNode);
        opts.onEvent({ kind: "message_delta", text: "<coder-complete>" });
      }),
    });

    const toolCall = eventStore.events.find((e) => e.kind === "tool_call");
    const toolResult = eventStore.events.find((e) => e.kind === "tool_result");
    expect(toolCall).toMatchObject({ callId: "call-xyz", subagent: "C-001" });
    expect(toolResult).toMatchObject({ callId: "call-xyz", subagent: "C-001" });
  });

  it("serializes exclusive nodes around other runnable work", async () => {
    await writeDag([
      node({ id: "C-001", writes: ["src/a.ts"], safety: "parallel-safe" }),
      node({ id: "C-002", writes: ["src/b.ts"], safety: "exclusive" }),
    ]);
    let active = 0;
    let maxActive = 0;
    const starts: string[] = [];

    const result = await runCode({
      ...baseOpts(),
      createAgentSession: fakeCreateAgentSession(async (dagNode) => {
        starts.push(dagNode.id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        await writeAssignedFiles(dagNode);
        active -= 1;
      }),
    });

    expect(result.ok).toBe(true);
    expect(maxActive).toBe(1);
    expect(starts).toEqual(["C-002", "C-001"]);
  });

  it("waits for dependencies before starting downstream nodes", async () => {
    await writeDag([
      node({ id: "C-001", writes: ["src/a.ts"] }),
      node({ id: "C-002", writes: ["src/b.ts"], dependsOn: ["C-001"] }),
    ]);
    const starts: string[] = [];

    const result = await runCode({
      ...baseOpts(),
      createAgentSession: fakeCreateAgentSession(async (dagNode) => {
        starts.push(dagNode.id);
        await writeAssignedFiles(dagNode);
      }),
    });

    expect(result.ok).toBe(true);
    expect(starts).toEqual(["C-001", "C-002"]);
  });

  it("blocks downstream nodes and fails the phase when a node fails", async () => {
    await writeDag([
      node({ id: "C-001", writes: ["src/a.ts"] }),
      node({ id: "C-002", writes: ["src/b.ts"], dependsOn: ["C-001"] }),
    ]);

    const result = await runCode({
      ...baseOpts(),
      createAgentSession: fakeCreateAgentSession(async (dagNode, opts) => {
        if (dagNode.id === "C-001") {
          opts.onEvent({ kind: "message_delta", text: '<coder-blocked reason="needs src/c.ts">' });
          return;
        }
        await writeAssignedFiles(dagNode);
      }),
    });

    expect(result.ok).toBe(false);
    const state = JSON.parse(await readFile(join(cwd, ".harness", "T-1", "code-state.json"), "utf8")) as {
      nodes: Record<string, { status: string }>;
    };
    expect(state.nodes["C-001"]?.status).toBe("failed");
    expect(state.nodes["C-002"]?.status).toBe("blocked");
  });

  it("does not expose Graphify tools to code agents", async () => {
    await writeDag([
      node({ id: "C-001", writes: ["src/a.ts"] }),
    ]);
    let createOpts: AgentSessionOptions | null = null;

    const result = await runCode({
      ...baseOpts(),
      createAgentSession: async (opts) => {
        createOpts = opts;
        return fakeSession(async (prompt) => {
          await writeAssignedFiles(extractAssignedNode(prompt));
          return usage;
        });
      },
    });

    expect(result.ok).toBe(true);
    expect(createOpts?.tools?.filter((tool) => tool.startsWith("graphify_"))).toEqual([]);
    expect(createOpts?.customTools?.map((tool) => tool.name).filter((tool) => tool.startsWith("graphify_")) ?? []).toEqual([]);
  });

  it("opens code node sessions through the managed session factory", async () => {
    await writeDag([
      node({ id: "C-001", writes: ["src/a.ts"] }),
    ]);
    const scopes: ManagedSessionScope[] = [];
    const sessionFactory: ManagedSessionFactory = {
      phase: "code",
      mainPath: join(cwd, ".harness", "T-1", "pi-session-code.jsonl"),
      pathFor: (scope) => join(cwd, ".harness", "T-1", scope.kind),
      open: async (scope, opts) => {
        scopes.push(scope);
        return fakeSession(async (prompt) => {
          expect("sessionPath" in opts).toBe(false);
          await writeAssignedFiles(extractAssignedNode(prompt));
          return usage;
        });
      },
    };

    const result = await runCode({
      ...baseOpts(),
      createAgentSession: async () => {
        throw new Error("raw session creation should not be used");
      },
      sessionFactory,
    });

    expect(result.ok).toBe(true);
    expect(scopes).toEqual([{ kind: "code-node", nodeId: "C-001" }]);
  });
});

function baseOpts() {
  return {
    taskId: "T-1",
    runId: "R-1",
    cwd,
    store,
    eventStore: eventStore as never,
    phaseModel: { provider: "test", model: "test-model", thinkingLevel: "off" as const },
    ticketTitle: "Task",
    ticketDescription: "Implement the task.",
  };
}

function fakeCreateAgentSession(behavior: NodeBehavior) {
  return async (opts: AgentSessionOptions) => ({
    async prompt(prompt: string) {
      await behavior(extractAssignedNode(prompt), opts);
      return usage;
    },
    async abort() {},
    async close() {},
  });
}

function fakeSession(promptBehavior: (prompt: string) => Promise<PromptUsage>) {
  return {
    async prompt(prompt: string) {
      return promptBehavior(prompt);
    },
    async abort() {},
    async close() {},
  };
}

function extractAssignedNode(prompt: string): ExecutionDagNode {
  const start = prompt.indexOf("# Assigned DAG node");
  const end = prompt.indexOf("# Completed dependency context");
  const section = prompt.slice(start, end);
  const open = section.indexOf("{");
  const close = section.lastIndexOf("}");
  return JSON.parse(section.slice(open, close + 1)) as ExecutionDagNode;
}

async function writeAssignedFiles(dagNode: ExecutionDagNode): Promise<void> {
  for (const path of dagNode.writes) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), `// ${dagNode.id}\n`);
  }
}

async function writeDag(nodes: ExecutionDagNode[]): Promise<void> {
  const body = [
    "version: 1",
    "nodes:",
    ...nodes.flatMap((dagNode) => [
      `  - id: ${dagNode.id}`,
      `    title: ${dagNode.title}`,
      `    phase: ${dagNode.phase}`,
      `    kind: ${dagNode.kind}`,
      `    lane: ${dagNode.lane}`,
      `    safety: ${dagNode.safety}`,
      `    dependsOn: [${dagNode.dependsOn.join(", ")}]`,
      "    writes:",
      ...dagNode.writes.map((path) => `      - ${path}`),
      "    reads: []",
      "    verifies:",
      "      - pnpm test",
      "    covers:",
      "      - REQ-001",
      "    blastRadius:",
      "      - BR-001",
      `    assertion: ${dagNode.assertion}`,
    ]),
  ].join("\n");
  const artifact: Artifact = {
    fm: {
      task: "T-1",
      kind: "execution-dag",
      parent: "plan.md",
      status: "ready",
      branch: "pi/T-1",
      last_updated: new Date().toISOString(),
      last_updated_by: "test",
    },
    body,
  };
  await store.writeArtifact(cwd, "T-1", artifact);
}

function node(overrides: Partial<ExecutionDagNode> & { id: string; writes: string[] }): ExecutionDagNode {
  return {
    id: overrides.id,
    title: `Node ${overrides.id}`,
    phase: "Build",
    kind: "code",
    lane: "default",
    safety: overrides.safety ?? "parallel-safe",
    dependsOn: overrides.dependsOn ?? [],
    writes: overrides.writes,
    reads: [],
    verifies: ["pnpm test"],
    covers: ["REQ-001"],
    blastRadius: ["BR-001"],
    assertion: "files are updated",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
