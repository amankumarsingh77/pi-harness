import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact } from "@pi-harness/shared";
import type { AgentSession, AgentSessionOptions } from "@pi-harness/pi-bridge";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { PlanEventBus } from "../../src/agents/plan-event-bus.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { runPlan } from "../../src/agents/plan.js";
import { PREFLIGHT_SUBAGENTS } from "../../src/agents/plan-preflight.js";
import type { AgentEvent } from "@pi-harness/shared";

let cwd: string;
let store: ArtifactsStore;

class InMemoryEventStore {
  private events: AgentEvent[] = [];
  async append(e: AgentEvent): Promise<void> {
    this.events.push(e);
  }
  async list(runId: string): Promise<AgentEvent[]> {
    return this.events.filter((e) => e.runId === runId);
  }
}

const validBlastRadiusBody = `items:
  - id: BR-001
    requirementRefs:
      - REQ-001
    surface: api
    title: Planner impact
    risk: medium
    touchpoints:
      - path: apps/orchestrator/src/agents/plan.ts
        role: change
        note: Planner session tools.
    inbound: []
    outbound: []
    precedentRefs: []
    verificationRefs: []
`;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "plan-agent-test-"));
  store = new ArtifactsStore();
  await seedPlanInputs();
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("runPlan", () => {
  it("passes explicit planner builtins plus mark_ready", async () => {
    const createOpts: AgentSessionOptions[] = [];
    const eventStore = new InMemoryEventStore();
    const bus = new PlanEventBus({
      eventStore: eventStore as never,
      jsonl: new JsonlWriter(join(cwd, ".harness", "T-1", "plan.jsonl")),
      runId: "r-1",
      taskId: "T-1",
    });

    await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus,
      eventStore: eventStore as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession: async (opts) => {
        createOpts.push(opts);
        return {
          async prompt() {
            return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
          },
          async abort() {},
          async close() {},
        } satisfies AgentSession;
      },
      ticketTitle: "Tool contracts",
      ticketDescription: "Align planner tools.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(createOpts).toHaveLength(1);
    expect(createOpts[0]!.tools).toEqual([
      "read",
      "grep",
      "find",
      "write",
      "mark_ready",
      "graphify_query",
      "graphify_path",
      "graphify_explain",
      "graphify_stats",
    ]);
    expect(createOpts[0]!.customTools?.map((tool) => tool.name)).toEqual([
      "mark_ready",
      "graphify_query",
      "graphify_path",
      "graphify_explain",
      "graphify_stats",
    ]);
  });

  it("continues to the planner after soft preflight agents fall back", async () => {
    const researchDir = join(cwd, ".harness", "T-1", "research");
    await Promise.all(
      PREFLIGHT_SUBAGENTS.map((subagent) =>
        unlink(join(researchDir, `${subagent}.md`)).catch(() => {}),
      ),
    );
    const promptTexts: string[] = [];
    const createAgentSession = async (opts: AgentSessionOptions): Promise<AgentSession> => {
      const writeFindings = (opts.customTools ?? []).find(
        (tool) => tool.name === "write_findings",
      ) as
        | (NonNullable<AgentSessionOptions["customTools"]>[number] & {
            __subagent: string;
          })
        | undefined;
      if (writeFindings) {
        const subagent = writeFindings.__subagent;
        if (subagent === "codebase-scout") {
          return {
            async prompt() {
              await writeFindings.execute(
                "test-write",
                { body: "# codebase-scout\n\nok\n" },
                undefined,
                undefined,
                undefined as never,
              );
              return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
            },
            async abort() {},
            async close() {},
          } satisfies AgentSession;
        }
        return {
          async prompt() {
            return new Promise(() => {});
          },
          async abort() {},
          async close() {},
        } satisfies AgentSession;
      }
      return {
        async prompt(text) {
          promptTexts.push(text);
          return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
        },
        async abort() {},
        async close() {},
      } satisfies AgentSession;
    };

    const first = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus: makeBus(),
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession,
      ticketTitle: "Fallback preflight",
      ticketDescription: "Soft agents hang.",
      claimVerifierState: { attempts: 0, cap: 2 },
      preflightSubagentTimeoutMs: 5,
      preflightRetrySubagentTimeoutMs: 5,
    });

    expect(first.ok).toBe(true);
    expect(first.ready).toBe(false);
    expect(promptTexts).toHaveLength(0);
    expect(await readFile(join(researchDir, "integration-scanner.md"), "utf8")).toContain("Fallback finding");
    expect(await readFile(join(researchDir, "precedent-locator.md"), "utf8")).toContain("Fallback finding");

    const second = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus: makeBus(),
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession,
      ticketTitle: "Fallback preflight",
      ticketDescription: "Soft agents hang.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(second.ok).toBe(true);
    expect(promptTexts).toHaveLength(1);
    expect(promptTexts[0]).toContain("Begin the plan phase");
  });

  it("recovers a stale planner_started event instead of no-oping", async () => {
    const promptTexts: string[] = [];
    await appendPlanJsonl([
      { kind: "plan_system", systemKind: "preflight_complete", data: { count: 3 } },
      { kind: "plan_system", systemKind: "planner_started", data: { mode: "initial" } },
    ]);

    const result = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus: makeBus(),
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession: async () => ({
        async prompt(text) {
          promptTexts.push(text);
          return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
        },
        async abort() {},
        async close() {},
      }),
      ticketTitle: "Recover",
      ticketDescription: "Planner stalled.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(true);
    expect(promptTexts).toHaveLength(1);
    expect(promptTexts[0]).toContain("Recover the plan phase");
    expect(await readPlanJsonl()).toContain("\"mode\":\"recovery\"");
    expect(await readPlanJsonl()).toContain("\"planner_turn_completed\"");
  });

  it("recovers a stale revision planner turn instead of repeating the revision prompt", async () => {
    const promptTexts: string[] = [];
    await appendPlanJsonl([
      { kind: "plan_system", systemKind: "preflight_complete", data: { count: 3 } },
      { kind: "plan_system", systemKind: "status_changed", data: { status: "ready" } },
      { kind: "plan_revision_requested", comment: "Please make the implementation safer." },
      { kind: "plan_system", systemKind: "planner_started", data: { mode: "revision" } },
      { kind: "plan_system", systemKind: "planner_turn_completed", data: { ready: false } },
    ]);

    const result = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus: makeBus(),
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession: async () => ({
        async prompt(text) {
          promptTexts.push(text);
          return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
        },
        async abort() {},
        async close() {},
      }),
      ticketTitle: "Recover revision",
      ticketDescription: "Revision planner stalled.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(true);
    expect(promptTexts).toHaveLength(1);
    expect(promptTexts[0]).toContain("Recover the plan phase");
    expect(promptTexts[0]).not.toContain("The user has requested revisions");
  });

  it("blocks after planner recovery attempts are exhausted without ready artifacts", async () => {
    await appendPlanJsonl([
      { kind: "plan_system", systemKind: "preflight_complete", data: { count: 3 } },
      { kind: "plan_system", systemKind: "planner_started", data: { mode: "initial" } },
      { kind: "plan_system", systemKind: "planner_turn_completed", data: { ready: false } },
      { kind: "plan_system", systemKind: "planner_started", data: { mode: "recovery", recoveryAttempt: 1 } },
      { kind: "plan_system", systemKind: "planner_turn_completed", data: { ready: false } },
      { kind: "plan_system", systemKind: "planner_started", data: { mode: "recovery", recoveryAttempt: 2 } },
      { kind: "plan_system", systemKind: "planner_turn_completed", data: { ready: false } },
    ]);

    const result = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus: makeBus(),
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession: async () => {
        throw new Error("should not start another planner session");
      },
      ticketTitle: "Recover",
      ticketDescription: "Planner stalled.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("planner recovery exhausted");
    expect(await readPlanJsonl()).toContain("\"systemKind\":\"blocked\"");
  });

  it("times out planner sessions and publishes a blocked event", async () => {
    let aborted = false;

    const result = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus: makeBus(),
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession: async () => ({
        async prompt() {
          return new Promise(() => {});
        },
        async abort() {
          aborted = true;
        },
        async close() {},
      }),
      ticketTitle: "Timeout",
      ticketDescription: "Planner hangs.",
      claimVerifierState: { attempts: 0, cap: 2 },
      plannerTimeoutMs: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("planner timed out");
    expect(aborted).toBe(true);
    expect(await readPlanJsonl()).toContain("\"systemKind\":\"blocked\"");
  });
});

function makeBus(): PlanEventBus {
  return new PlanEventBus({
    eventStore: new InMemoryEventStore() as never,
    jsonl: new JsonlWriter(join(cwd, ".harness", "T-1", "plan.jsonl")),
    runId: "r-1",
    taskId: "T-1",
  });
}

async function appendPlanJsonl(events: readonly Record<string, unknown>[]): Promise<void> {
  const writer = new JsonlWriter(join(cwd, ".harness", "T-1", "plan.jsonl"));
  for (const event of events) {
    await writer.append({ ts: new Date().toISOString(), ...event });
  }
}

async function readPlanJsonl(): Promise<string> {
  return readFile(join(cwd, ".harness", "T-1", "plan.jsonl"), "utf8");
}

async function seedPlanInputs(): Promise<void> {
  await store.writeArtifact(cwd, "T-1", makeArtifact("design", "## Goals\nAlign tools.\n"));
  await store.writeArtifact(cwd, "T-1", makeArtifact("spec", "## Acceptance criteria\nTools match.\n"));
  await store.writeArtifact(cwd, "T-1", makeArtifact("blast-radius", validBlastRadiusBody));
  const researchDir = join(cwd, ".harness", "T-1", "research");
  await mkdir(researchDir, { recursive: true });
  for (const subagent of PREFLIGHT_SUBAGENTS) {
    await writeFile(join(researchDir, `${subagent}.md`), `# ${subagent}\n`);
  }
}

function makeArtifact(kind: Artifact["fm"]["kind"], body: string): Artifact {
  return {
    fm: {
      task: "T-1",
      kind,
      parent: kind === "design" ? null : "design.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-16T00:00:00.000Z",
      last_updated_by: "test",
    },
    body,
  };
}
