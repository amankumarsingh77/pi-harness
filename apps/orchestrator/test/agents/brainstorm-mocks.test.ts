import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { BrainstormEventBus } from "../../src/agents/brainstorm-event-bus.js";
import {
  makeSubmitMockChoicesTool,
  makeWriteMockRevisionTool,
} from "../../src/agents/brainstorm-tools.js";

let scratch: string;
let cwd: string;
const TASK = "T-1";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bs-mocks-"));
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

function makeMock(mockId = "mock-a") {
  return {
    mockId,
    title: "Split pane",
    summary: "Shows options beside artifacts.",
    recommended: true,
    createdAt: "2026-05-13T00:00:00.000Z",
    pages: [
      {
        pageId: "task-detail",
        title: "Task detail",
        htmlPath: `.harness/T-1/mocks/${mockId}/task-detail.html`,
      },
      {
        pageId: "brainstorm-review",
        title: "Brainstorm review",
        htmlPath: `.harness/T-1/mocks/${mockId}/brainstorm-review.html`,
      },
    ],
  };
}

const MOCK_HTML = [
  { pageId: "task-detail", html: "<!doctype html><h1>Task detail</h1>" },
  { pageId: "brainstorm-review", html: "<!doctype html><h1>Brainstorm review</h1>" },
];

async function fakeExecute<P, D>(
  tool: {
    execute: (
      id: string,
      params: P,
      signal: AbortSignal | undefined,
      onUpdate: undefined,
      ctx: never,
    ) => Promise<{ details: D; terminate?: boolean; content: unknown }>;
  },
  params: P,
): Promise<{ details: D; terminate?: boolean; content: unknown }> {
  return tool.execute("call-1", params, undefined, undefined, undefined as never);
}

describe("brainstorm mock artifact storage", () => {
  it("writes mock HTML and updates the manifest without selecting it", async () => {
    const store = new ArtifactsStore();
    const mock = makeMock();

    await store.writeBrainstormMock(cwd, TASK, mock, MOCK_HTML);

    await expect(
      store.readBrainstormMockHtml(cwd, TASK, "mock-a", "task-detail"),
    ).resolves.toContain("Task detail");
    await expect(
      store.readBrainstormMockHtml(cwd, TASK, "mock-a", "brainstorm-review"),
    ).resolves.toContain("Brainstorm review");
    await expect(store.readBrainstormMockManifest(cwd, TASK)).resolves.toEqual({
      mocks: [mock],
      selectedMockId: null,
    });
  });

  it("selects an existing mock in the manifest", async () => {
    const store = new ArtifactsStore();
    const mock = makeMock();
    await store.writeBrainstormMock(cwd, TASK, mock, MOCK_HTML);

    await store.selectBrainstormMock(cwd, TASK, "mock-a");

    await expect(store.readBrainstormMockManifest(cwd, TASK)).resolves.toEqual({
      mocks: [mock],
      selectedMockId: "mock-a",
    });
  });
});

describe("brainstorm mock tools", () => {
  it("submit_mock_choices writes files, publishes proposal events, and terminates", async () => {
    const store = new ArtifactsStore();
    const { bus, eventAppends } = makeBus();
    const tool = makeSubmitMockChoicesTool({ store, bus, cwd, taskId: TASK });

    const result = await fakeExecute(tool, {
      mocks: [
        {
          mockId: "mock-a",
          title: "Split pane",
          summary: "Shows options beside artifacts.",
          recommended: true,
          pages: [
            {
              pageId: "task-detail",
              title: "Task detail",
              html: "<h1>Task detail</h1>",
            },
            {
              pageId: "brainstorm-review",
              title: "Brainstorm review",
              summary: "Review page",
              html: "<h1>Brainstorm review</h1>",
            },
          ],
        },
      ],
    });

    expect(result.terminate).toBe(true);
    expect(result.details).toEqual({ proposed: ["mock-a"] });
    expect(eventAppends).toHaveLength(1);
    expect(eventAppends[0]).toMatchObject({
      kind: "brainstorm_mock_proposed",
      mock: {
        mockId: "mock-a",
        recommended: true,
        pages: [
          {
            pageId: "task-detail",
            htmlPath: ".harness/T-1/mocks/mock-a/task-detail.html",
          },
          {
            pageId: "brainstorm-review",
            htmlPath: ".harness/T-1/mocks/mock-a/brainstorm-review.html",
          },
        ],
      },
    });
    await expect(
      store.readBrainstormMockHtml(cwd, TASK, "mock-a", "task-detail"),
    ).resolves.toContain("Task detail");
  });

  it("write_mock_revision creates a derived mock revision and publishes it", async () => {
    const store = new ArtifactsStore();
    const { bus, eventAppends } = makeBus();
    const tool = makeWriteMockRevisionTool({ store, bus, cwd, taskId: TASK });
    await store.writeBrainstormMock(cwd, TASK, makeMock(), MOCK_HTML);

    const result = await fakeExecute(tool, {
      sourceMockId: "mock-a",
      mockId: "mock-a",
      editRequestId: "mer_1",
      title: "Split pane refined",
      summary: "Narrows the artifact pane.",
      pages: [
        {
          pageId: "task-detail",
          title: "Task detail",
          html: "<h1>Mock A revised</h1>",
        },
      ],
    });

    expect(result.details).toEqual({ revised: "mock-a-rev1" });
    expect(eventAppends).toHaveLength(1);
    expect(eventAppends[0]).toMatchObject({
      kind: "brainstorm_mock_revised",
      editRequestId: "mer_1",
      mock: {
        mockId: "mock-a-rev1",
        derivedFrom: "mock-a",
      },
    });
    await expect(
      store.readBrainstormMockHtml(cwd, TASK, "mock-a-rev1", "task-detail"),
    ).resolves.toContain("revised");
  });

  it("write_mock_revision allocates the next revision id for repeated edits", async () => {
    const store = new ArtifactsStore();
    const { bus, eventAppends } = makeBus();
    const tool = makeWriteMockRevisionTool({ store, bus, cwd, taskId: TASK });
    await store.writeBrainstormMock(cwd, TASK, makeMock(), MOCK_HTML);
    await store.writeBrainstormMock(cwd, TASK, {
      ...makeMock("mock-a-rev1"),
      mockId: "mock-a-rev1",
      title: "Split pane refined",
      summary: "Narrows the artifact pane.",
      recommended: false,
      createdAt: "2026-05-13T00:00:01.000Z",
      derivedFrom: "mock-a",
    }, [{ pageId: "task-detail", html: "<h1>Mock A rev1</h1>" }]);

    const result = await fakeExecute(tool, {
      sourceMockId: "mock-a",
      mockId: "mock-a",
      editRequestId: "mer_2",
      title: "Split pane refined again",
      summary: "Further narrows the artifact pane.",
      pages: [
        {
          pageId: "task-detail",
          title: "Task detail",
          html: "<h1>Mock A rev2</h1>",
        },
      ],
    });

    expect(result.details).toEqual({ revised: "mock-a-rev2" });
    expect(eventAppends[0]).toMatchObject({
      kind: "brainstorm_mock_revised",
      mock: {
        mockId: "mock-a-rev2",
        derivedFrom: "mock-a",
      },
    });
    await expect(
      store.readBrainstormMockHtml(cwd, TASK, "mock-a-rev2", "task-detail"),
    ).resolves.toContain("rev2");
  });
});
