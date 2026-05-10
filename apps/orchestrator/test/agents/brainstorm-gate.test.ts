import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { deriveBrainstormGate } from "../../src/agents/brainstorm-gate.js";
import type { ArtifactStatus } from "@pi-harness/shared";

const TASK = "t-1";
const store = new ArtifactsStore();

describe("deriveBrainstormGate", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bgate-"));
    await mkdir(join(cwd, ".harness", TASK), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function setArtifacts(
    designStatus: ArtifactStatus,
    specStatus: ArtifactStatus,
  ): Promise<void> {
    await store.writeArtifact(cwd, TASK, {
      fm: {
        task: TASK,
        kind: "design",
        parent: null,
        branch: `pi/${TASK}`,
        status: designStatus,
        last_updated: "2026-05-09T00:00:00Z",
        last_updated_by: "test",
      },
      body: "# design\n",
    });
    await store.writeArtifact(cwd, TASK, {
      fm: {
        task: TASK,
        kind: "spec",
        parent: "design.md",
        branch: `pi/${TASK}`,
        status: specStatus,
        last_updated: "2026-05-09T00:00:00Z",
        last_updated_by: "test",
      },
      body: "# spec\n",
    });
  }

  async function appendJsonl(events: Record<string, unknown>[]): Promise<void> {
    const path = join(cwd, ".harness", TASK, "brainstorm.jsonl");
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(path, lines);
  }

  it("running when no artifacts exist", async () => {
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("running");
  });

  it("running when only design is ready", async () => {
    await setArtifacts("ready", "draft");
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("running");
  });

  it("awaiting_user when both artifacts ready and no events", async () => {
    await setArtifacts("ready", "ready");
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("awaiting_user");
  });

  it("awaiting_user when one artifact is ready and the other is human_edited", async () => {
    await setArtifacts("ready", "human_edited");
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("awaiting_user");
  });

  it("awaiting_user when both artifacts are human_edited", async () => {
    await setArtifacts("human_edited", "human_edited");
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("awaiting_user");
  });

  it("awaiting_user when ready event preceded any revision", async () => {
    await setArtifacts("ready", "ready");
    await appendJsonl([
      { ts: "2026-05-09T00:00:00Z", kind: "brainstorm_revision_requested", comment: "old" },
      {
        ts: "2026-05-09T00:01:00Z",
        kind: "brainstorm_system",
        systemKind: "status_changed",
        data: { status: "ready" },
      },
    ]);
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("awaiting_user");
  });

  it("running when revision filed after the last ready event (regression)", async () => {
    // This is the exact bug the unified gate fixes: the artifacts may still
    // be on disk with status: ready (the route's reset happens immediately
    // after but the gate must already report running so a no-op tick can't
    // re-fire agent_phase_succeeded).
    await setArtifacts("ready", "ready");
    await appendJsonl([
      {
        ts: "2026-05-09T00:00:00Z",
        kind: "brainstorm_system",
        systemKind: "status_changed",
        data: { status: "ready" },
      },
      { ts: "2026-05-09T00:01:00Z", kind: "brainstorm_revision_requested", comment: "redo" },
    ]);
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("running");
  });

  it("ignores non-ready status_changed events", async () => {
    await setArtifacts("ready", "ready");
    await appendJsonl([
      {
        ts: "2026-05-09T00:00:00Z",
        kind: "brainstorm_system",
        systemKind: "status_changed",
        data: { status: "draft" },
      },
      { ts: "2026-05-09T00:01:00Z", kind: "brainstorm_revision_requested", comment: "x" },
    ]);
    expect(await deriveBrainstormGate(cwd, TASK, store)).toBe("running");
  });
});
