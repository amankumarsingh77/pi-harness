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
    const mock = {
      mockId: "mock-a",
      title: "Split pane",
      summary: "Shows options beside artifacts.",
      htmlPath: ".harness/T-1/mocks/mock-a.html",
      recommended: true,
      createdAt: "2026-05-13T00:00:00.000Z",
    };

    await store.writeBrainstormMock(cwd, TASK, mock, "<!doctype html><h1>Mock A</h1>");

    await expect(store.readBrainstormMockHtml(cwd, TASK, "mock-a")).resolves.toContain("Mock A");
    await expect(store.readBrainstormMockManifest(cwd, TASK)).resolves.toEqual({
      mocks: [mock],
      selectedMockId: null,
    });
  });

  it("selects an existing mock in the manifest", async () => {
    const store = new ArtifactsStore();
    const mock = {
      mockId: "mock-a",
      title: "Split pane",
      summary: "Shows options beside artifacts.",
      htmlPath: ".harness/T-1/mocks/mock-a.html",
      recommended: false,
      createdAt: "2026-05-13T00:00:00.000Z",
    };
    await store.writeBrainstormMock(cwd, TASK, mock, "<h1>Mock A</h1>");

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
          html: "<h1>Mock A</h1>",
          recommended: true,
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
        htmlPath: ".harness/T-1/mocks/mock-a.html",
        recommended: true,
      },
    });
    await expect(store.readBrainstormMockHtml(cwd, TASK, "mock-a")).resolves.toContain("Mock A");
  });

  it("write_mock_revision creates a derived mock revision and publishes it", async () => {
    const store = new ArtifactsStore();
    const { bus, eventAppends } = makeBus();
    const tool = makeWriteMockRevisionTool({ store, bus, cwd, taskId: TASK });

    const result = await fakeExecute(tool, {
      sourceMockId: "mock-a",
      mockId: "mock-a-rev1",
      editRequestId: "mer_1",
      title: "Split pane refined",
      summary: "Narrows the artifact pane.",
      html: "<h1>Mock A revised</h1>",
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
    await expect(store.readBrainstormMockHtml(cwd, TASK, "mock-a-rev1")).resolves.toContain(
      "revised",
    );
  });
});
