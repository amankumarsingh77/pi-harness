import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { Artifact } from "@pi-harness/shared";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { derivePlanGate } from "../../src/agents/plan-gate.js";

let scratch: string;
let cwd: string;
let store: ArtifactsStore;

const seedArtifact = (kind: "plan" | "scenarios" | "blast-radius", status: string): Artifact => ({
  fm: {
    task: "T-1",
    kind,
    parent: kind === "plan" ? "design.md" : kind === "scenarios" ? "plan.md" : "spec.md",
    status: status as never,
    branch: "pi/T-1",
    last_updated: new Date().toISOString(),
    last_updated_by: "test",
  },
  body: kind === "plan" ? "# Plan\n" : kind === "scenarios" ? "scenarios: []\n" : "items: []\n",
});

async function appendJsonl(line: object) {
  await mkdir(join(cwd, ".harness", "T-1"), { recursive: true });
  await appendFile(
    join(cwd, ".harness", "T-1", "plan.jsonl"),
    JSON.stringify(line) + "\n",
  );
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "plan-gate-test-"));
  cwd = join(scratch, "wt");
  await mkdir(cwd, { recursive: true });
  const git = simpleGit(cwd);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(cwd, ".gitignore"), ".harness/\n");
  await writeFile(join(cwd, "README.md"), "init\n");
  await git.add(["README.md", ".gitignore"]);
  await git.commit("init");
  await git.checkoutLocalBranch("pi/T-1");
  store = new ArtifactsStore();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("derivePlanGate", () => {
  it("returns running when both artifacts are draft", async () => {
    await store.writeArtifact(cwd, "T-1", seedArtifact("plan", "draft"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("scenarios", "draft"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("blast-radius", "draft"));
    expect(await derivePlanGate(cwd, "T-1", store)).toBe("running");
  });

  it("returns running when any artifact is not ready", async () => {
    await store.writeArtifact(cwd, "T-1", seedArtifact("plan", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("scenarios", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("blast-radius", "draft"));
    expect(await derivePlanGate(cwd, "T-1", store)).toBe("running");
  });

  it("returns awaiting_user when all plan artifacts are ready and no revision filed", async () => {
    await store.writeArtifact(cwd, "T-1", seedArtifact("plan", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("scenarios", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("blast-radius", "ready"));
    await appendJsonl({
      ts: new Date().toISOString(),
      kind: "plan_system",
      systemKind: "status_changed",
      data: { status: "ready" },
    });
    expect(await derivePlanGate(cwd, "T-1", store)).toBe("awaiting_user");
  });

  it("returns running when revision postdates last ready event", async () => {
    await store.writeArtifact(cwd, "T-1", seedArtifact("plan", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("scenarios", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("blast-radius", "ready"));
    await appendJsonl({
      ts: "2026-05-10T10:00:00.000Z",
      kind: "plan_system",
      systemKind: "status_changed",
      data: { status: "ready" },
    });
    await appendJsonl({
      ts: "2026-05-10T11:00:00.000Z",
      kind: "plan_revision_requested",
      comment: "tighten scope",
    });
    expect(await derivePlanGate(cwd, "T-1", store)).toBe("running");
  });

  it("returns awaiting_user when artifacts ready but no JSONL events (test fixtures)", async () => {
    await store.writeArtifact(cwd, "T-1", seedArtifact("plan", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("scenarios", "ready"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("blast-radius", "ready"));
    expect(await derivePlanGate(cwd, "T-1", store)).toBe("awaiting_user");
  });

  it("returns awaiting_user with human_edited and approved statuses too", async () => {
    await store.writeArtifact(cwd, "T-1", seedArtifact("plan", "human_edited"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("scenarios", "approved"));
    await store.writeArtifact(cwd, "T-1", seedArtifact("blast-radius", "ready"));
    expect(await derivePlanGate(cwd, "T-1", store)).toBe("awaiting_user");
  });
});
