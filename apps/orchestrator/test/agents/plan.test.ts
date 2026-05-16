import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    ]);
    expect(createOpts[0]!.customTools?.map((tool) => tool.name)).toEqual([
      "mark_ready",
    ]);
  });
});

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
