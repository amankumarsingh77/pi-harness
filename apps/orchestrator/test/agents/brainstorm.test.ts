import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { runBrainstorm } from "../../src/agents/brainstorm.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { BrainstormEventBus } from "../../src/agents/brainstorm-event-bus.js";
import { scaffoldBrainstorm } from "../../src/runner/scaffold-brainstorm.js";
import {
  BRAINSTORM_SCRIPT,
  SCRIPT_QUESTION_COUNT,
} from "../../src/agents/brainstorm-script.js";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bs-agent-"));
  await mkdir(scratch, { recursive: true });
  const git = simpleGit(scratch);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(scratch, "README.md"), "init\n");
  await git.add("README.md");
  await git.commit("init");
  await git.checkoutLocalBranch("pi/T-1");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function makeFakes() {
  const eventStoreAppends: any[] = [];
  const eventStore = {
    append: vi.fn(async (e: unknown) => { eventStoreAppends.push(e); }),
  };
  return { eventStore, eventStoreAppends };
}

function makeBus(cwd: string, taskId: string, eventStore: any) {
  const jsonl = new JsonlWriter(join(cwd, ".harness", taskId, "brainstorm.jsonl"));
  return { bus: new BrainstormEventBus({ eventStore: eventStore as never, jsonl, runId: "r1", taskId }), jsonl };
}

function nextUnansweredQ(lines: any[]): any {
  const answeredIds = new Set(
    lines.filter((e) => e.kind === "brainstorm_answer").map((e) => e.questionId),
  );
  return lines.find(
    (e) => e.kind === "brainstorm_question" && !answeredIds.has(e.questionId),
  );
}

async function answerLatest(cwd: string, taskId: string, optionId: string): Promise<void> {
  // Append a brainstorm_answer for the earliest unanswered question. Batched
  // script steps emit several questions at once; "earliest unanswered" works
  // for both single and batched cases.
  const path = join(cwd, ".harness", taskId, "brainstorm.jsonl");
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
  const q = nextUnansweredQ(lines);
  if (!q) throw new Error("no unanswered question");
  const answer = JSON.stringify({
    ts: new Date().toISOString(),
    kind: "brainstorm_answer",
    questionId: q.questionId,
    optionId,
  });
  await writeFile(path, raw + answer + "\n");
}

describe("runBrainstorm (scripted mock)", () => {
  it("first invocation emits probe + first question, halts", async () => {
    await scaffoldBrainstorm({ cwd: scratch, taskId: "T-1", branch: "pi/T-1" });
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const { bus } = makeBus(scratch, "T-1", eventStore);

    const r = await runBrainstorm({ taskId: "T-1", cwd: scratch, store, bus });
    expect(r.ok).toBe(true);
    expect(r.ready).toBe(false);

    const jsonl = await readFile(join(scratch, ".harness", "T-1", "brainstorm.jsonl"), "utf8");
    const events = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
    // probe_complete + first question
    expect(events.find((e) => e.systemKind === "probe_complete")).toBeDefined();
    expect(events.filter((e) => e.kind === "brainstorm_question")).toHaveLength(1);
  });

  it("walking through all questions completes with ready=true", async () => {
    await scaffoldBrainstorm({ cwd: scratch, taskId: "T-1", branch: "pi/T-1" });
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const { bus } = makeBus(scratch, "T-1", eventStore);

    // First call → probe + Q1
    let r = await runBrainstorm({ taskId: "T-1", cwd: scratch, store, bus });
    expect(r.ready).toBe(false);

    // Answer each question in turn; each runBrainstorm tick should emit the
    // next question until the last, after which ready=true.
    const recommendedFor: Record<string, string> = {
      q_scope: "narrow",
      q_constraint: "correctness",
      q_alternative: "abstract",
      q_verification: "unit_e2e",
      q_acceptance: "functional",
    };
    for (let i = 0; i < SCRIPT_QUESTION_COUNT; i++) {
      const path = join(scratch, ".harness", "T-1", "brainstorm.jsonl");
      const raw = await readFile(path, "utf8");
      const events = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
      const nextQ = nextUnansweredQ(events);
      const optionId = recommendedFor[nextQ.questionId as string]!;
      await answerLatest(scratch, "T-1", optionId);
      r = await runBrainstorm({ taskId: "T-1", cwd: scratch, store, bus });
    }

    expect(r.ready).toBe(true);

    // Both artifacts should now have status: ready
    const design = await store.readArtifact(scratch, "T-1", "design");
    const spec = await store.readArtifact(scratch, "T-1", "spec");
    expect(design?.fm.status).toBe("ready");
    expect(spec?.fm.status).toBe("ready");
    // Body content should reflect answers (incremental writes)
    expect(design!.body).toContain("narrow");
    expect(spec!.body).toContain("end-to-end");
  });

  it("does not duplicate already-emitted events on resume", async () => {
    await scaffoldBrainstorm({ cwd: scratch, taskId: "T-1", branch: "pi/T-1" });
    const store = new ArtifactsStore({ runsDir: scratch });
    const { eventStore } = makeFakes();
    const { bus } = makeBus(scratch, "T-1", eventStore);

    // Two ticks without answering — second should be a no-op (still halted on Q1).
    await runBrainstorm({ taskId: "T-1", cwd: scratch, store, bus });
    await runBrainstorm({ taskId: "T-1", cwd: scratch, store, bus });

    const jsonl = await readFile(join(scratch, ".harness", "T-1", "brainstorm.jsonl"), "utf8");
    const events = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);
    expect(events.filter((e) => e.systemKind === "probe_complete")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "brainstorm_question")).toHaveLength(1);
  });
});

describe("BRAINSTORM_SCRIPT integrity", () => {
  it("contains question, self_critique, and ready steps in order", () => {
    const kinds = BRAINSTORM_SCRIPT.map((s) => s.kind);
    const lastQ = kinds.lastIndexOf("question");
    const critique = kinds.indexOf("self_critique");
    const ready = kinds.indexOf("ready");
    expect(lastQ).toBeGreaterThanOrEqual(0);
    expect(critique).toBeGreaterThan(lastQ);
    expect(ready).toBeGreaterThan(critique);
  });

  it("each question has exactly one (recommended) option", () => {
    for (const step of BRAINSTORM_SCRIPT) {
      if (step.kind !== "question") continue;
      const recCount = step.options.filter((o) => o.recommended).length;
      expect(recCount, `q ${step.id}`).toBe(1);
    }
  });
});
