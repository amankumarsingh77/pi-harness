import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact } from "@pi-harness/shared";
import type { AgentSession, AgentSessionOptions } from "@pi-harness/pi-bridge";
import { PLAN_RESEARCH_SUBAGENTS } from "@pi-harness/subagents";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { PlanEventBus } from "../../src/agents/plan-event-bus.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { runPlan } from "../../src/agents/plan.js";
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
  it("passes planner builtins plus restricted plan custom tools", async () => {
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
      "spawn_plan_agent",
      "write_plan_artifact",
      "mark_ready",
    ]);
    expect(createOpts[0]!.customTools?.map((tool) => tool.name)).toEqual([
      "spawn_plan_agent",
      "write_plan_artifact",
      "mark_ready",
    ]);
  });

  it("starts the planner directly instead of running automatic preflight agents", async () => {
    const promptTexts: string[] = [];
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
      ticketTitle: "Planner direct",
      ticketDescription: "No automatic preflight.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(true);
    expect(result.ready).toBe(false);
    expect(promptTexts).toHaveLength(1);
    expect(promptTexts[0]).toContain("Begin the plan phase");
  });

  it("rejects non-plan-research templates in spawn_plan_agent", async () => {
    const spawnResults: unknown[] = [];

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
      createAgentSession: async (opts) => ({
        async prompt() {
          const spawn = opts.customTools?.find((tool) => tool.name === "spawn_plan_agent");
          if (!spawn) throw new Error("spawn_plan_agent tool not registered");
          const spawnResult = await spawn.execute(
            "spawn",
            {
              role: "claim-verifier",
              title: "Misused audit agent",
              lane: "audit",
              instructions: "Audit this early.",
            },
            undefined,
            undefined,
            undefined as never,
          );
          spawnResults.push(spawnResult.details);
          return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
        },
        async abort() {},
        async close() {},
      }),
      ticketTitle: "Spawn boundary",
      ticketDescription: "Planner should only spawn plan research agents.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(true);
    expect(spawnResults).toEqual([
      expect.objectContaining({
        ok: false,
        error: "role is not planner-spawnable: claim-verifier",
      }),
    ]);
  });

  it("returns dynamic child findings directly to the planner without writing a research artifact", async () => {
    const spawnResults: unknown[] = [];
    const planEvents: unknown[] = [];
    const bus = new PlanEventBus({
      eventStore: new InMemoryEventStore() as never,
      jsonl: new JsonlWriter(join(cwd, ".harness", "T-1", "plan.jsonl")),
      runId: "r-1",
      taskId: "T-1",
    });
    const originalPublish = bus.publish.bind(bus);
    bus.publish = async (input) => {
      planEvents.push(input);
      return originalPublish(input);
    };

    const result = await runPlan({
      taskId: "T-1",
      runId: "r-1",
      cwd,
      store,
      bus,
      eventStore: new InMemoryEventStore() as never,
      phaseModel: {
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingLevel: "high",
      },
      sessionPath: join(cwd, ".harness", "T-1", "pi-session-plan.jsonl"),
      createAgentSession: async (opts) => ({
        async prompt(text) {
          const returnFindings = opts.customTools?.find((tool) => tool.name === "return_findings");
          if (returnFindings) {
            await returnFindings.execute(
              "return-findings",
              { body: "# Findings\n\nPattern: apps/orchestrator/src/agents/plan.ts:152" },
              undefined,
              undefined,
              undefined as never,
            );
            return { costUsd: 0.02, inputTokens: 50, outputTokens: 20 };
          }
          expect(text).toContain("findings bodies returned by spawn_plan_agent");
          const spawn = opts.customTools?.find((tool) => tool.name === "spawn_plan_agent");
          if (!spawn) throw new Error("spawn_plan_agent tool not registered");
          const spawnResult = await spawn.execute(
            "spawn",
            {
              role: "codebase-scout",
              title: "Scout codebase",
              lane: "research",
              instructions: "Find the relevant files.",
            },
            undefined,
            undefined,
            undefined as never,
          );
          spawnResults.push(spawnResult.details);
          return { costUsd: 0.01, inputTokens: 10, outputTokens: 5 };
        },
        async abort() {},
        async close() {},
      }),
      ticketTitle: "Direct findings",
      ticketDescription: "Planner should consume returned child findings.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(true);
    expect(spawnResults).toEqual([
      expect.objectContaining({
        ok: true,
        findingsBody: "# Findings\n\nPattern: apps/orchestrator/src/agents/plan.ts:152",
      }),
    ]);
    expect(planEvents).toContainEqual(
      expect.objectContaining({
        kind: "plan_agent_node_started",
        artifactPath: null,
        tools: expect.arrayContaining(["return_findings"]),
      }),
    );
    expect(planEvents).toContainEqual(
      expect.objectContaining({
        kind: "plan_agent_node_findings",
        body: "# Findings\n\nPattern: apps/orchestrator/src/agents/plan.ts:152",
      }),
    );
    const researchFiles = await readdir(join(cwd, ".harness", "T-1", "research"));
    expect(researchFiles.sort()).toEqual(
      [...PLAN_RESEARCH_SUBAGENTS].map((subagent) => `${subagent}.md`).sort(),
    );
  });

  it("fails dynamic child agents that exit without returning findings", async () => {
    const spawnResults: unknown[] = [];

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
      createAgentSession: async (opts) => ({
        async prompt() {
          if (opts.customTools?.some((tool) => tool.name === "return_findings")) {
            return { costUsd: 0.02, inputTokens: 50, outputTokens: 20 };
          }
          const spawn = opts.customTools?.find((tool) => tool.name === "spawn_plan_agent");
          if (!spawn) throw new Error("spawn_plan_agent tool not registered");
          const spawnResult = await spawn.execute(
            "spawn",
            {
              role: "codebase-scout",
              title: "Scout codebase",
              lane: "research",
              instructions: "Find the relevant files.",
            },
            undefined,
            undefined,
            undefined as never,
          );
          spawnResults.push(spawnResult.details);
          return { costUsd: 0.01, inputTokens: 10, outputTokens: 5 };
        },
        async abort() {},
        async close() {},
      }),
      ticketTitle: "Missing findings",
      ticketDescription: "Planner should know when child findings are absent.",
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    expect(result.ok).toBe(true);
    expect(spawnResults).toEqual([
      expect.objectContaining({
        ok: false,
        error: "child agent completed without returning findings",
      }),
    ]);
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

  it("does not timeout planner sessions", async () => {
    vi.useFakeTimers();
    let aborted = false;
    let finishPrompt: ((usage: { costUsd: number; inputTokens: number; outputTokens: number }) => void) | undefined;
    let markPromptStarted: (() => void) | undefined;
    const promptStarted = new Promise<void>((resolve) => {
      markPromptStarted = resolve;
    });

    try {
      const resultPromise = runPlan({
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
            markPromptStarted?.();
            return new Promise<{ costUsd: number; inputTokens: number; outputTokens: number }>((resolve) => {
              finishPrompt = resolve;
            });
          },
          async abort() {
            aborted = true;
          },
          async close() {},
        }),
        ticketTitle: "No planner timeout",
        ticketDescription: "Planner may run for longer than five minutes.",
        claimVerifierState: { attempts: 0, cap: 2 },
      });

      await promptStarted;
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(aborted).toBe(false);
      finishPrompt?.({ costUsd: 0, inputTokens: 1, outputTokens: 1 });

      const result = await resultPromise;
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(aborted).toBe(false);
      expect(await readPlanJsonl()).not.toContain("\"systemKind\":\"blocked\"");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a hung claim-verifier launched from mark_ready", async () => {
    vi.useFakeTimers();
    await appendPlanJsonl([
      { kind: "plan_system", systemKind: "preflight_complete", data: { count: 3 } },
    ]);
    await seedPlannerOutputArtifacts();

    let claimVerifierAbortCalled = false;
    let markVerifierPromptStarted: (() => void) | undefined;
    let finishVerifierPrompt: ((usage: { costUsd: number; inputTokens: number; outputTokens: number }) => void) | undefined;
    const verifierPromptStarted = new Promise<void>((resolve) => {
      markVerifierPromptStarted = resolve;
    });
    const controller = new AbortController();
    let markReadySettled = false;

    const resultPromise = runPlan({
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
      createAgentSession: async (opts) => {
        const writeFindings = (opts.customTools ?? []).some(
          (tool) => tool.name === "write_findings",
        );
        if (writeFindings) {
          return {
            async prompt() {
              markVerifierPromptStarted?.();
              return new Promise<{ costUsd: number; inputTokens: number; outputTokens: number }>((resolve) => {
                finishVerifierPrompt = resolve;
              });
            },
            async abort() {
              claimVerifierAbortCalled = true;
              finishVerifierPrompt?.({ costUsd: 0, inputTokens: 0, outputTokens: 0 });
            },
            async close() {},
          } satisfies AgentSession;
        }

        return {
          async prompt() {
            const markReady = (opts.customTools ?? []).find(
              (tool) => tool.name === "mark_ready",
            );
            if (!markReady) throw new Error("mark_ready tool not registered");
            const result = await markReady.execute(
              "mark-ready",
              {},
              undefined,
              undefined,
              undefined as never,
            );
            markReadySettled = true;
            expect(result.details.ok).toBe(false);
            expect(result.details.missing).toContain("claim-verifier");
            return { costUsd: 0, inputTokens: 1, outputTokens: 1 };
          },
          async abort() {},
          async close() {},
        } satisfies AgentSession;
      },
      ticketTitle: "Verifier timeout",
      ticketDescription: "Claim verifier hangs.",
      signal: controller.signal,
      claimVerifierState: { attempts: 0, cap: 2 },
    });

    try {
      await verifierPromptStarted;
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      const result = await resultPromise;
      expect(markReadySettled).toBe(true);
      expect(claimVerifierAbortCalled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.ready).toBe(false);
      const planJsonl = await readPlanJsonl();
      expect(planJsonl).toContain("claim-verifier timed out");
      expect(planJsonl).toContain("\"planner_turn_completed\"");
      expect(planJsonl).toContain("\"ready\":false");
    } finally {
      controller.abort();
      finishVerifierPrompt?.({ costUsd: 0, inputTokens: 0, outputTokens: 0 });
      await resultPromise.catch(() => {});
      vi.useRealTimers();
    }
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
  for (const subagent of PLAN_RESEARCH_SUBAGENTS) {
    await writeFile(join(researchDir, `${subagent}.md`), `# ${subagent}\n`);
  }
}

async function seedPlannerOutputArtifacts(): Promise<void> {
  await store.writeArtifact(cwd, "T-1", makeArtifact("plan", validIndexedPlanBody));
  await store.writeArtifact(cwd, "T-1", makePhaseArtifact(1, validPhasePlanBody));
  await store.writeArtifact(cwd, "T-1", makeArtifact("scenarios", validScenariosYaml));
  await store.writeArtifact(cwd, "T-1", makeArtifact("execution-dag", validExecutionDagYaml));
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

function makePhaseArtifact(phase: number, body: string): Artifact {
  return {
    fm: {
      task: "T-1",
      kind: "phase-plan",
      parent: "plan.md",
      phase,
      status: "draft",
      branch: "pi/T-1",
      last_updated: "2026-05-16T00:00:00.000Z",
      last_updated_by: "test",
    },
    body,
  };
}

const validScenariosYaml = `scenarios:
  - id: s1
    type: api
    name: smoke
    description: GET /health returns 200 and the body reports the service is up.
    requirementRefs:
      - REQ-001
    blastRadiusRefs:
      - BR-001
`;

const validExecutionDagYaml = `version: 1
nodes:
  - id: C-001
    title: Add backoff helper
    phase: Foundation
    kind: api
    lane: orchestrator
    safety: exclusive
    dependsOn: []
    writes:
      - src/webhooks.ts
    reads:
      - src/foo.ts
    verifies:
      - pnpm test
    covers:
      - REQ-001
    blastRadius:
      - BR-001
    assertion: webhook test passes with 5 retries
waves:
  - id: W-001
    name: Foundation
    policy: sequential
    nodes:
      - C-001
`;

const validIndexedPlanBody = [
  "# Plan",
  "",
  "## Goal",
  "Add retry to webhooks.",
  "",
  "## Plan Summary",
  "Phase 1 builds the retry foundation.",
  "",
  "## Phase DAG",
  "Foundation -> Verification",
  "",
  "## Phases",
  "- Phase 1: Foundation — Details: plan-1.md — Covers: REQ-001 — Blast radius: BR-001",
  "",
  "## Cross-Phase Risks",
  "- Retry behavior must not double-send webhooks.",
  "",
  "## Out of scope",
  "- Inbound webhook receipts",
].join("\n");

const validPhasePlanBody = [
  "# Phase 1: Foundation",
  "",
  "## Objective",
  "Build the retry foundation.",
  "",
  "## Decisions",
  "- Reuse the existing webhook route shape.",
  "",
  "## Touchpoints",
  "- `src/webhooks.ts` — retry send path.",
  "",
  "## Work Slices",
  "### C-001: Add backoff helper",
  "- Files: modify `src/webhooks.ts`",
  "- Covers: REQ-001",
  "- Blast radius: BR-001",
  "- Assertion: webhook test passes with 5 retries",
  "",
  "## Phase Verification Contract",
  "- Run `pnpm test`.",
  "- Scenario `s1` proves the route stays healthy.",
  "",
  "## Failure Modes",
  "- Retrying can double-send webhooks.",
  "",
  "## Exit Criteria",
  "- C-001 is implemented and verified.",
].join("\n");
