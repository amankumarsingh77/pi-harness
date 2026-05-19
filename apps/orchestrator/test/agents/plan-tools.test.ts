import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { Artifact } from "@pi-harness/shared";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { PlanEventBus } from "../../src/agents/plan-event-bus.js";
import {
  makeMarkReadyTool,
  validateExecutionDagYaml,
  validateScenariosYaml,
  parseFalsifiedClaims,
  type ClaimVerifierState,
  type DispatchClaimVerifier,
} from "../../src/agents/plan-tools.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { ClaimLedgerStore } from "../../src/adapters/mission-store.js";
import type { AgentEvent } from "@pi-harness/shared";

class InMemoryEventStore {
  private events: AgentEvent[] = [];
  async append(e: AgentEvent): Promise<void> {
    this.events.push(e);
  }
  async list(runId: string): Promise<AgentEvent[]> {
    return this.events.filter((e) => e.runId === runId);
  }
}

let scratch: string;
let cwd: string;
let store: ArtifactsStore;
let bus: PlanEventBus;
let eventStore: InMemoryEventStore;

const validScenariosYaml = `scenarios:
  - id: s1
    type: api
    name: smoke
    requirementRefs:
      - REQ-001
    blastRadiusRefs:
      - BR-001
    request:
      method: GET
      url: http://localhost/health
    expect:
      status: 200
`;

const validBlastRadiusYaml = `items:
  - id: BR-001
    requirementRefs:
      - REQ-001
    surface: api
    title: Health route impact
    risk: medium
    touchpoints:
      - path: src/webhooks.ts
        role: change
        note: Current send path has no retry.
    inbound: []
    outbound: []
    precedentRefs: []
    verificationRefs:
      - s1
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

const validPlanBody = [
  "# Plan",
  "",
  "## Goal",
  "Add retry to webhooks.",
  "",
  "## Patterns to follow",
  "- `src/foo.ts:42` — exponential backoff helper",
  "",
  "## Touchpoints",
  "- api: `src/webhooks.ts` — current send path has no retry",
  "",
  "## Blast radius",
  "- outbound: third-party webhook receivers",
  "",
  "## Precedent warnings",
  "- abc123 — last retry attempt double-billed receivers",
  "",
  "## Steps",
  "1. Add backoff helper",
  "   - modify src/webhooks.ts",
  "   - Assertion: webhook test passes with 5 retries",
  "",
  "## Out of scope",
  "- Inbound webhook receipts",
].join("\n");

async function seedRepo() {
  const git = simpleGit(cwd);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(cwd, ".gitignore"), ".harness/\n");
  await writeFile(join(cwd, "README.md"), "init\n");
  await git.add(["README.md", ".gitignore"]);
  await git.commit("init");
  await git.checkoutLocalBranch("pi/T-1");
}

async function writePlanArtifacts(
  planBody: string,
  scenariosBody: string,
  blastRadiusBody = validBlastRadiusYaml,
  executionDagBody = validExecutionDagYaml,
) {
  const plan: Artifact = {
    fm: {
      task: "T-1",
      kind: "plan",
      parent: "design.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: new Date().toISOString(),
      last_updated_by: "orchestrator",
    },
    body: planBody,
  };
  const scenarios: Artifact = {
    fm: {
      task: "T-1",
      kind: "scenarios",
      parent: "plan.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: new Date().toISOString(),
      last_updated_by: "orchestrator",
    },
    body: scenariosBody,
  };
  const blastRadius: Artifact = {
    fm: {
      task: "T-1",
      kind: "blast-radius",
      parent: "spec.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: new Date().toISOString(),
      last_updated_by: "orchestrator",
    },
    body: blastRadiusBody,
  };
  const executionDag: Artifact = {
    fm: {
      task: "T-1",
      kind: "execution-dag",
      parent: "plan.md",
      status: "draft",
      branch: "pi/T-1",
      last_updated: new Date().toISOString(),
      last_updated_by: "orchestrator",
    },
    body: executionDagBody,
  };
  await store.writeArtifact(cwd, "T-1", plan);
  await store.writeArtifact(cwd, "T-1", scenarios);
  await store.writeArtifact(cwd, "T-1", blastRadius);
  await store.writeArtifact(cwd, "T-1", executionDag);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "plan-tools-test-"));
  cwd = join(scratch, "wt");
  await mkdir(cwd, { recursive: true });
  await seedRepo();
  store = new ArtifactsStore();
  eventStore = new InMemoryEventStore();
  await mkdir(join(cwd, ".harness", "T-1"), { recursive: true });
  bus = new PlanEventBus({
    eventStore: eventStore as never,
    jsonl: new JsonlWriter(join(cwd, ".harness", "T-1", "plan.jsonl")),
    runId: "r-1",
    taskId: "T-1",
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const noopDispatcher: DispatchClaimVerifier = async () => ({
  falsifiedClaims: [],
  findingsWritten: true,
});
const newState = (): ClaimVerifierState => ({ attempts: 0, cap: 2 });

describe("mark_ready", () => {
  it("rejects when plan.md is missing", async () => {
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toBe("plan.md not found");
  });

  it("rejects when scenarios.yaml is missing", async () => {
    const planOnly: Artifact = {
      fm: {
        task: "T-1",
        kind: "plan",
        parent: "design.md",
        status: "draft",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "orchestrator",
      },
      body: validPlanBody,
    };
    await store.writeArtifact(cwd, "T-1", planOnly);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toBe("scenarios.yaml not found");
  });

  it("rejects when blast-radius.yaml is missing", async () => {
    const plan: Artifact = {
      fm: {
        task: "T-1",
        kind: "plan",
        parent: "design.md",
        status: "draft",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "orchestrator",
      },
      body: validPlanBody,
    };
    const scenarios: Artifact = {
      fm: {
        task: "T-1",
        kind: "scenarios",
        parent: "plan.md",
        status: "draft",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "orchestrator",
      },
      body: validScenariosYaml,
    };
    await store.writeArtifact(cwd, "T-1", plan);
    await store.writeArtifact(cwd, "T-1", scenarios);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toBe("blast-radius.yaml not found");
  });

  it("rejects when execution-dag.yaml is missing", async () => {
    const plan: Artifact = {
      fm: {
        task: "T-1",
        kind: "plan",
        parent: "design.md",
        status: "draft",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "orchestrator",
      },
      body: validPlanBody,
    };
    const scenarios: Artifact = {
      fm: {
        task: "T-1",
        kind: "scenarios",
        parent: "plan.md",
        status: "draft",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "orchestrator",
      },
      body: validScenariosYaml,
    };
    const blastRadius: Artifact = {
      fm: {
        task: "T-1",
        kind: "blast-radius",
        parent: "spec.md",
        status: "draft",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "orchestrator",
      },
      body: validBlastRadiusYaml,
    };
    await store.writeArtifact(cwd, "T-1", plan);
    await store.writeArtifact(cwd, "T-1", scenarios);
    await store.writeArtifact(cwd, "T-1", blastRadius);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toBe("execution-dag.yaml not found");
  });

  it("rejects when a required section is missing", async () => {
    const planMissing = validPlanBody.replace("## Out of scope\n- Inbound webhook receipts", "");
    await writePlanArtifacts(planMissing, validScenariosYaml);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("## Out of scope");
  });

  it("rejects when a required section is empty", async () => {
    const planEmpty = validPlanBody.replace(
      "## Out of scope\n- Inbound webhook receipts",
      "## Out of scope\n",
    );
    await writePlanArtifacts(planEmpty, validScenariosYaml);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("## Out of scope");
    expect(result.details.missing).toContain("empty");
  });

  it("rejects when scenarios.yaml is malformed YAML", async () => {
    await writePlanArtifacts(validPlanBody, "scenarios: [unclosed\n");
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("scenarios.yaml");
  });

  it("rejects when scenarios.yaml fails schema (missing required field)", async () => {
    const bad = `scenarios:
  - id: s1
    type: api
    name: smoke
    request:
      method: GET
      url: http://localhost/health
`; // expect.status missing
    await writePlanArtifacts(validPlanBody, bad);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("scenarios.yaml");
  });

  it("rejects when blast-radius.yaml fails schema", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml, "items: []\n");
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("blast-radius.yaml");
  });

  it("rejects when execution-dag.yaml fails schema", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml, validBlastRadiusYaml, "version: 1\nnodes: []\n");
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("execution-dag.yaml");
  });

  it("rejects when a C-step is missing a matching DAG node", async () => {
    const planWithCStep = validPlanBody.replace(
      "1. Add backoff helper",
      "1. C-002 Add backoff helper",
    );
    await writePlanArtifacts(planWithCStep, validScenariosYaml);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("C-002");
  });

  it("rejects when claim-verifier flags Falsified claims", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml);
    const dispatcher = vi.fn(async () => ({
      falsifiedClaims: ["pattern at src/foo.ts:42 does not exist"],
      findingsWritten: true,
    }));
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: dispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("claim-verifier");
    expect(result.details.missing).toContain("does not exist");
    expect(dispatcher).toHaveBeenCalledTimes(1);
  });

  it("rejects when claim-verifier ends without writing findings (silent-pass guard)", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml);
    const dispatcher = vi.fn(async () => ({
      falsifiedClaims: [],
      findingsWritten: false,
    }));
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: dispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("without writing findings");

    const plan = await store.readArtifact(cwd, "T-1", "plan");
    expect(plan?.fm.status).toBe("draft");
  });

  it("claim-verifier dispatch is capped at 2 attempts per run", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml);
    const dispatcher = vi.fn(async () => ({
      falsifiedClaims: ["c1"],
      findingsWritten: true,
    }));
    const state = newState();
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: dispatcher,
      claimVerifierState: state,
    });

    // First call dispatches.
    let r = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(r.details.ok).toBe(false);
    expect(dispatcher).toHaveBeenCalledTimes(1);

    // Second call dispatches.
    r = await tool.execute("t2", {}, undefined, undefined, null as never);
    expect(r.details.ok).toBe(false);
    expect(dispatcher).toHaveBeenCalledTimes(2);

    // Third call: cap exhausted, no dispatch.
    r = await tool.execute("t3", {}, undefined, undefined, null as never);
    expect(r.details.ok).toBe(false);
    expect(r.details.missing).toContain("exhausted");
    expect(dispatcher).toHaveBeenCalledTimes(2);
  });

  it("succeeds: flips all plan artifacts to ready and publishes status_changed event", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml);
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(true);
    expect(result.terminate).toBe(true);

    const plan = await store.readArtifact(cwd, "T-1", "plan");
    const scenarios = await store.readArtifact(cwd, "T-1", "scenarios");
    const blastRadius = await store.readArtifact(cwd, "T-1", "blast-radius");
    const executionDag = await store.readArtifact(cwd, "T-1", "execution-dag");
    expect(plan?.fm.status).toBe("ready");
    expect(scenarios?.fm.status).toBe("ready");
    expect(blastRadius?.fm.status).toBe("ready");
    expect(executionDag?.fm.status).toBe("ready");
    expect(plan?.fm.last_updated_by).toBe("plan-agent");

    const events = await eventStore.list("r-1");
    const statusChanged = events.find(
      (e) => e.kind === "plan_system" && (e as { systemKind?: string }).systemKind === "status_changed",
    );
    expect(statusChanged).toBeDefined();
  });

  it("idempotent: succeeds again without writing when already ready", async () => {
    const planReady: Artifact = {
      fm: {
        task: "T-1",
        kind: "plan",
        parent: "design.md",
        status: "ready",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "plan-agent",
      },
      body: validPlanBody,
    };
    const scenariosReady: Artifact = {
      fm: {
        task: "T-1",
        kind: "scenarios",
        parent: "plan.md",
        status: "ready",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "plan-agent",
      },
      body: validScenariosYaml,
    };
    const blastRadiusReady: Artifact = {
      fm: {
        task: "T-1",
        kind: "blast-radius",
        parent: "spec.md",
        status: "ready",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "plan-agent",
      },
      body: validBlastRadiusYaml,
    };
    const executionDagReady: Artifact = {
      fm: {
        task: "T-1",
        kind: "execution-dag",
        parent: "plan.md",
        status: "ready",
        branch: "pi/T-1",
        last_updated: new Date().toISOString(),
        last_updated_by: "plan-agent",
      },
      body: validExecutionDagYaml,
    };
    await store.writeArtifact(cwd, "T-1", planReady);
    await store.writeArtifact(cwd, "T-1", scenariosReady);
    await store.writeArtifact(cwd, "T-1", blastRadiusReady);
    await store.writeArtifact(cwd, "T-1", executionDagReady);

    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
    });
    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(true);
  });

  it("syncs initial claims from execution DAG and scenarios after mark_ready succeeds", async () => {
    await writePlanArtifacts(validPlanBody, validScenariosYaml);
    const claimLedger = new ClaimLedgerStore({ stateDir: scratch });
    const published: number[] = [];
    const tool = makeMarkReadyTool({
      store, bus, cwd, taskId: "T-1",
      dispatchClaimVerifier: noopDispatcher,
      claimVerifierState: newState(),
      claimLedger,
      claimPublisher: {
        publishClaimsUpdated: async (_taskId, payload) => {
          published.push(payload.claimEvents.length);
        },
      },
    });

    const result = await tool.execute("t1", {}, undefined, undefined, null as never);
    expect(result.details.ok).toBe(true);

    await tool.execute("t2", {}, undefined, undefined, null as never);
    const claims = await claimLedger.listClaims("T-1");
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.sourceKey).sort()).toEqual([
      "execution-dag:C-001",
      "scenario:s1",
    ]);
    expect(claims.map((claim) => claim.text).sort()).toEqual([
      "Scenario smoke must pass",
      "webhook test passes with 5 retries",
    ]);
    expect(published).toEqual([2]);
  });
});

describe("validateScenariosYaml", () => {
  it("returns null on a valid file", () => {
    expect(validateScenariosYaml(validScenariosYaml)).toBeNull();
  });

  it("returns a YAML parse error on malformed input", () => {
    expect(validateScenariosYaml("scenarios: [unclosed")).toMatch(/YAML parse/);
  });

  it("returns a schema error when scenarios is empty", () => {
    expect(validateScenariosYaml("scenarios: []")).toContain("scenarios");
  });
});

describe("validateExecutionDagYaml", () => {
  it("returns null on a valid file", () => {
    expect(validateExecutionDagYaml(validExecutionDagYaml)).toBeNull();
  });

  it("returns a schema error when the DAG has no nodes", () => {
    expect(validateExecutionDagYaml("version: 1\nnodes: []")).toContain("nodes");
  });
});

describe("parseFalsifiedClaims", () => {
  it("returns empty when no Falsified entries", () => {
    expect(parseFalsifiedClaims("# claims\n## c1\nVerified\n")).toEqual([]);
  });

  it("collects pipe-delimited Falsified finding rows with justifications", () => {
    const findings = [
      "FINDING S1 | Verified | quote matches at src/a.ts:1",
      "FINDING S2 | Falsified | cited file src/missing.ts does not exist",
      "FINDING S3 | Weakened | narrower than stated at src/b.ts:2",
      "FINDING S4 | Falsified | claim contradicted by src/c.ts:3",
    ].join("\n");

    expect(parseFalsifiedClaims(findings)).toEqual([
      "S2: cited file src/missing.ts does not exist",
      "S4: claim contradicted by src/c.ts:3",
    ]);
  });

  it("collects each header preceded by a Falsified marker", () => {
    const md = [
      "# Audit",
      "## Claim 1",
      "Verified",
      "## Claim 2",
      "Falsified — file does not exist",
      "## Claim 3",
      "**Falsified**",
    ].join("\n");
    expect(parseFalsifiedClaims(md)).toEqual(["Claim 2", "Claim 3"]);
  });
});
