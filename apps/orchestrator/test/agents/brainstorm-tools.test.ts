import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact, ArtifactKind } from "@pi-harness/shared";
import { stringifyArtifact } from "@pi-harness/shared";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { BrainstormEventBus } from "../../src/agents/brainstorm-event-bus.js";
import {
  makeSubmitQuestionsTool,
  makeMarkReadyTool,
  makeReplyToUserTool,
} from "../../src/agents/brainstorm-tools.js";

let scratch: string;
let cwd: string;
const TASK = "T-1";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bs-tools-"));
  cwd = join(scratch, "wt");
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

type AppendCall = Record<string, unknown>;

function makeBus() {
  const eventAppends: AppendCall[] = [];
  const jsonlAppends: AppendCall[] = [];
  const eventStore = { append: vi.fn(async (e: AppendCall) => { eventAppends.push(e); }) };
  const jsonl = {
    append: vi.fn(async (e: AppendCall) => { jsonlAppends.push(e); }),
    filePath: () => "/dev/null",
  };
  const bus = new BrainstormEventBus({
    eventStore: eventStore as never,
    jsonl: jsonl as never,
    runId: "r1",
    taskId: TASK,
  });
  return { bus, eventAppends, jsonlAppends };
}

function makeStore() {
  return new ArtifactsStore({ runsDir: join(scratch, "runs") });
}

function makeArtifact(kind: ArtifactKind, body: string, status: "draft" | "ready" = "draft"): Artifact {
  return {
    fm: {
      task: TASK,
      kind,
      parent: null,
      status,
      branch: "pi/T-1",
      last_updated: "2026-05-09T00:00:00.000Z",
      last_updated_by: "orchestrator",
    },
    body,
  };
}

const VALID_DESIGN_BODY = [
  "## Problem",
  "Users need a clearer brainstorm contract.",
  "",
  "## Context",
  "The current brainstorm artifacts are too terse for planning.",
  "",
  "## Requirements",
  "- Functional: write planner-ready artifacts.",
  "",
  "## Architectural Decisions",
  "- Use markdown sections with stable headings.",
  "",
  "## Approaches Considered",
  "- Keep the old minimal format.",
  "",
  "## Data Shapes / Contracts",
  "- `design.md` and `spec.md` remain harness-owned markdown artifacts.",
  "",
  "## Architecture",
  "The brainstorm agent writes both artifacts and then calls mark_ready.",
  "",
  "## External Dependencies & Fallback Chain",
  "None — pure-internal prompt and validation change.",
  "",
  "## Risks & Mitigations",
  "- Risk: verbose docs become vague. Mitigation: require verification mapping.",
  "",
  "## Assumptions",
  "- The planner reads both artifacts before planning.",
  "",
  "## Open Questions",
  "None blocking.",
  "",
  "## What This Does NOT Do",
  "- Move artifacts out of `.harness/<taskId>`.",
  "",
].join("\n");

const VALID_SPEC_BODY = [
  "## Glossary",
  "- Brainstorm artifact: the design/spec pair authored before planning.",
  "",
  "## Requirements",
  "| ID | Type | Requirement | Acceptance Criterion | Priority |",
  "| --- | --- | --- | --- | --- |",
  "| REQ-001 | Event-driven | The system shall reject incomplete brainstorm artifacts. | mark_ready returns a missing-section error. | Must |",
  "",
  "## Edge Cases",
  "| ID | Scenario | Expected Behavior | Derived From |",
  "| --- | --- | --- | --- |",
  "| EDGE-001 | Empty section body. | mark_ready rejects the artifact. | REQ-001 |",
  "",
  "## Verification Matrix",
  "| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |",
  "| --- | --- | --- | --- | --- | --- |",
  "| REQ-001 | Yes | Yes | No | No | Brainstorm tool tests cover this. |",
  "",
  "## Verification scenarios",
  "Hit the API and assert 200.",
  "",
  "## Out of Scope",
  "- Semantic LLM grading of artifact quality.",
  "",
].join("\n");

async function writeArtifactFile(
  store: ArtifactsStore,
  kind: ArtifactKind,
  body: string,
  status: "draft" | "ready" = "draft",
): Promise<void> {
  await store.writeArtifact(cwd, TASK, makeArtifact(kind, body, status));
}

async function fakeExecute<P, D>(
  tool: { execute: (id: string, params: P, signal: AbortSignal | undefined, onUpdate: undefined, ctx: never) => Promise<{ details: D; terminate?: boolean; content: unknown }> },
  params: P,
): Promise<{ details: D; terminate?: boolean; content: unknown }> {
  return tool.execute("call-1", params, undefined, undefined, undefined as never);
}

describe("makeSubmitQuestionsTool", () => {
  it("publishes a single brainstorm_question event with all fields propagated", async () => {
    const { bus, eventAppends, jsonlAppends } = makeBus();
    const tool = makeSubmitQuestionsTool({ bus });
    const params = {
      questions: [
        {
          questionId: "q-scope",
          prompt: "What's the scope?",
          options: [
            { id: "narrow", label: "Narrow", recommended: true, evidence: ["src/foo.ts:10"] },
            { id: "wide", label: "Wide", recommended: false, evidence: [] },
          ],
          sectionTarget: { artifact: "design" as const, section: "Goals" },
        },
      ],
    };
    const result = await fakeExecute(tool, params);

    expect(result.terminate).toBe(true);
    expect(result.details).toEqual({ awaiting: ["q-scope"] });
    expect(jsonlAppends).toHaveLength(1);
    expect(eventAppends).toHaveLength(1);
    const published = eventAppends[0] as Record<string, unknown>;
    expect(published.kind).toBe("brainstorm_question");
    expect(published.questionId).toBe("q-scope");
    expect(published.prompt).toBe("What's the scope?");
    expect(published.sectionTarget).toEqual({ artifact: "design", section: "Goals" });
    expect(published.options).toEqual(params.questions[0]!.options);
    expect("multiSelect" in published).toBe(false);
    expect(typeof published.batchId).toBe("string");
    expect(String(published.batchId)).toMatch(/^b_/);
  });

  it("stamps every question in one tool call with the same batchId", async () => {
    const { bus, eventAppends } = makeBus();
    const tool = makeSubmitQuestionsTool({ bus });
    await fakeExecute(tool, {
      questions: [
        {
          questionId: "q-a",
          prompt: "A?",
          options: [
            { id: "o1", label: "O1", recommended: true, evidence: [] },
            { id: "o2", label: "O2", recommended: false, evidence: [] },
          ],
          sectionTarget: { artifact: "design" as const, section: "Goals" },
        },
        {
          questionId: "q-b",
          prompt: "B?",
          options: [
            { id: "o1", label: "O1", recommended: true, evidence: [] },
            { id: "o2", label: "O2", recommended: false, evidence: [] },
          ],
          sectionTarget: { artifact: "spec" as const, section: "Acceptance" },
        },
      ],
    });
    expect(eventAppends).toHaveLength(2);
    const a = eventAppends[0] as Record<string, unknown>;
    const b = eventAppends[1] as Record<string, unknown>;
    expect(a.batchId).toBe(b.batchId);
  });

  it("propagates multiSelect flag when set", async () => {
    const { bus, eventAppends } = makeBus();
    const tool = makeSubmitQuestionsTool({ bus });
    await fakeExecute(tool, {
      questions: [
        {
          questionId: "q1",
          prompt: "Pick any",
          options: [
            { id: "a", label: "A", recommended: false, evidence: [] },
            { id: "b", label: "B", recommended: false, evidence: [] },
          ],
          sectionTarget: { artifact: "spec" as const, section: "Acceptance criteria" },
          multiSelect: true,
        },
      ],
    });
    expect((eventAppends[0] as Record<string, unknown>).multiSelect).toBe(true);
  });

  it("declares minItems=1 on questions in its TypeBox schema", () => {
    const { bus } = makeBus();
    const tool = makeSubmitQuestionsTool({ bus });
    const schema = tool.parameters as { properties: { questions: { minItems?: number } } };
    expect(schema.properties.questions.minItems).toBe(1);
  });
});

describe("makeMarkReadyTool", () => {
  it("returns missing detail when design.md is absent (no terminate, no status_changed)", async () => {
    const { bus, eventAppends } = makeBus();
    const store = makeStore();
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});
    expect(result.details).toEqual({
      ok: false,
      missing: "design.md not found",
      kind: "design",
      path: expect.stringContaining("/.harness/T-1/design.md"),
    });
    expect(result.terminate).toBeUndefined();
    expect(eventAppends).toHaveLength(0);
  });

  it("returns missing detail when spec.md is absent", async () => {
    const { bus, eventAppends } = makeBus();
    const store = makeStore();
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY);
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});
    expect(result.details).toEqual({
      ok: false,
      missing: "spec.md not found",
      kind: "spec",
      path: expect.stringContaining("/.harness/T-1/spec.md"),
    });
    expect(eventAppends).toHaveLength(0);
  });

  it("returns missing detail when spec.md lacks ## Verification Matrix", async () => {
    const { bus } = makeBus();
    const store = makeStore();
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY);
    await writeArtifactFile(store, "spec", [
      "## Glossary",
      "foo",
      "",
      "## Requirements",
      "foo",
      "",
      "## Edge Cases",
      "foo",
      "",
      "## Verification scenarios",
      "foo",
      "",
      "## Out of Scope",
      "foo",
      "",
    ].join("\n"));
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});
    expect(result.details).toEqual({
      ok: false,
      missing: "spec.md missing: ## Verification Matrix",
      kind: "spec",
      path: expect.stringContaining("/.harness/T-1/spec.md"),
    });
    expect(result.terminate).toBeUndefined();
  });

  it("requires External research section when brainstorm web research exists", async () => {
    const { bus } = makeBus();
    const store = makeStore();
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY);
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY);
    const researchDir = join(cwd, ".harness", TASK, "brainstorm-research");
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, "web-search-researcher.md"), "findings");
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });

    const result = await fakeExecute(tool, {});

    expect(result.details).toEqual({
      ok: false,
      missing: "design.md missing: ## External research",
      kind: "design",
      path: expect.stringContaining("/.harness/T-1/design.md"),
    });
  });

  it("reports missing when section heading is present but body is whitespace-only", async () => {
    const { bus } = makeBus();
    const store = makeStore();
    await writeArtifactFile(
      store,
      "design",
      VALID_DESIGN_BODY.replace(
        "## Architectural Decisions\n- Use markdown sections with stable headings.",
        "## Architectural Decisions\n   ",
      ),
    );
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY);
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});
    expect(result.details).toEqual({
      ok: false,
      missing: "design.md missing: ## Architectural Decisions (empty)",
      kind: "design",
      path: expect.stringContaining("/.harness/T-1/design.md"),
    });
  });

  it("happy path flips both files to ready, publishes status_changed, terminates", async () => {
    const { bus, eventAppends } = makeBus();
    const store = makeStore();
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY);
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY);
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});

    expect(result.details).toEqual({ ok: true });
    expect(result.terminate).toBe(true);

    const design = await store.readArtifact(cwd, TASK, "design");
    const spec = await store.readArtifact(cwd, TASK, "spec");
    expect(design?.fm.status).toBe("ready");
    expect(spec?.fm.status).toBe("ready");
    expect(design?.fm.last_updated_by).toBe("brainstorm-agent");
    expect(spec?.fm.last_updated_by).toBe("brainstorm-agent");

    expect(eventAppends).toHaveLength(1);
    const ev = eventAppends[0] as Record<string, unknown>;
    expect(ev.kind).toBe("brainstorm_system");
    expect(ev.systemKind).toBe("status_changed");
    expect(ev.data).toEqual({ status: "ready" });
  });

  it("idempotent: a second call when both already ready short-circuits without re-publishing", async () => {
    const { bus, eventAppends } = makeBus();
    const store = makeStore();
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY, "ready");
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY, "ready");
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});

    expect(result.details).toEqual({ ok: true });
    expect(result.terminate).toBe(true);
    expect(eventAppends).toHaveLength(0);
  });

  it("rejects when frontmatter status is approved (or other terminal state)", async () => {
    const { bus, eventAppends } = makeBus();
    const store = makeStore();
    // Manually write file with status: approved.
    const dir = join(cwd, ".harness", TASK);
    await mkdir(dir, { recursive: true });
    const approved: Artifact = {
      fm: {
        task: TASK,
        kind: "design",
        parent: null,
        status: "approved",
        branch: "pi/T-1",
        last_updated: "2026-05-09T00:00:00.000Z",
        last_updated_by: "user",
      },
      body: VALID_DESIGN_BODY,
    };
    await writeFile(join(dir, "design.md"), stringifyArtifact(approved));
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY);
    const tool = makeMarkReadyTool({ store, bus, cwd, taskId: TASK, countPendingNudges: async () => 0 });
    const result = await fakeExecute(tool, {});
    expect(result.details).toEqual({
      ok: false,
      missing: "design.md frontmatter status invalid (got: approved)",
      kind: "design",
      path: expect.stringContaining("/.harness/T-1/design.md"),
    });
    expect(eventAppends).toHaveLength(0);
  });

  it("rejects with structured error when nudges are pending", async () => {
    const { bus, eventAppends } = makeBus();
    const store = makeStore();
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY);
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY);
    const tool = makeMarkReadyTool({
      store,
      bus,
      cwd,
      taskId: TASK,
      countPendingNudges: async () => 2,
    });
    const result = await fakeExecute(tool, {});
    expect(result.details.ok).toBe(false);
    expect(result.details.missing).toContain("2 pending user nudge");
    expect(result.terminate).toBeUndefined();
    // No status_changed published — the artifacts stay in draft.
    expect(eventAppends).toHaveLength(0);
  });

  it("rejects when brainstorm mocks exist but selected mock is not reflected in artifacts", async () => {
    const { bus } = makeBus();
    const store = makeStore();
    await store.writeBrainstormMock(cwd, TASK, {
      mockId: "mock-a",
      title: "Split pane",
      summary: "Shows options beside artifacts.",
      recommended: true,
      createdAt: "2026-05-13T00:00:00.000Z",
      pages: [
        {
          pageId: "task-detail",
          title: "Task detail",
          htmlPath: ".harness/T-1/mocks/mock-a/task-detail.html",
        },
      ],
    }, [{ pageId: "task-detail", html: "<h1>Mock A</h1>" }]);
    await writeArtifactFile(store, "design", VALID_DESIGN_BODY);
    await writeArtifactFile(store, "spec", VALID_SPEC_BODY);
    const tool = makeMarkReadyTool({
      store,
      bus,
      cwd,
      taskId: TASK,
      countPendingNudges: async () => 0,
    });

    const result = await fakeExecute(tool, {});

    expect(result.details).toEqual({
      ok: false,
      missing: "selected mock missing from design.md and spec.md",
    });
  });

  it("accepts mocks when selected mock is reflected in both brainstorm artifacts", async () => {
    const { bus } = makeBus();
    const store = makeStore();
    await store.writeBrainstormMock(cwd, TASK, {
      mockId: "mock-a",
      title: "Split pane",
      summary: "Shows options beside artifacts.",
      recommended: true,
      createdAt: "2026-05-13T00:00:00.000Z",
      pages: [
        {
          pageId: "task-detail",
          title: "Task detail",
          htmlPath: ".harness/T-1/mocks/mock-a/task-detail.html",
        },
      ],
    }, [{ pageId: "task-detail", html: "<h1>Mock A</h1>" }]);
    await store.selectBrainstormMock(cwd, TASK, "mock-a");
    await writeArtifactFile(
      store,
      "design",
      `${VALID_DESIGN_BODY}\n## Selected UI direction\nSelected mock: mock-a\n`,
    );
    await writeArtifactFile(
      store,
      "spec",
      `${VALID_SPEC_BODY}\n## UI acceptance criteria\nSelected mock: mock-a\n`,
    );
    const tool = makeMarkReadyTool({
      store,
      bus,
      cwd,
      taskId: TASK,
      countPendingNudges: async () => 0,
    });

    const result = await fakeExecute(tool, {});

    expect(result.details).toEqual({ ok: true });
  });
});

describe("makeReplyToUserTool", () => {
  it("publishes a brainstorm_agent_reply event and does NOT terminate the turn", async () => {
    const { bus, jsonlAppends } = makeBus();
    const tool = makeReplyToUserTool({ bus });
    const result = await tool.execute(
      "tc1",
      { message: "Yes, that's everything I wanted to ask for now." },
      undefined,
      undefined,
      undefined as never,
    );
    expect(result.terminate).toBeUndefined();
    expect(result.details.replyId).toMatch(/^r_/);
    expect(jsonlAppends).toHaveLength(1);
    expect(jsonlAppends[0]).toMatchObject({
      kind: "brainstorm_agent_reply",
      message: "Yes, that's everything I wanted to ask for now.",
    });
    // Generated replyId is present and non-empty.
    expect(typeof jsonlAppends[0]!["replyId"]).toBe("string");
  });

  it("threads inReplyToNudgeId when the agent provides one", async () => {
    const { bus, jsonlAppends } = makeBus();
    const tool = makeReplyToUserTool({ bus });
    await tool.execute(
      "tc1",
      { message: "Acknowledged.", inReplyToNudgeId: "n_abc" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(jsonlAppends[0]).toMatchObject({
      kind: "brainstorm_agent_reply",
      inReplyToNudgeId: "n_abc",
    });
  });
});
