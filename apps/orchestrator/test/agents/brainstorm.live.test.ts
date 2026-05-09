import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, appendFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { createAgentSession } from "@pi-harness/pi-bridge";
import { DEFAULT_PHASE_MODELS } from "@pi-harness/shared";
import { runBrainstorm } from "../../src/agents/brainstorm.js";
import { ArtifactsStore } from "../../src/agents/artifacts-store.js";
import { JsonlWriter } from "../../src/adapters/jsonl-writer.js";
import { BrainstormEventBus } from "../../src/agents/brainstorm-event-bus.js";
import { scaffoldBrainstorm } from "../../src/runner/scaffold-brainstorm.js";

const TASK = "T-LIVE";
const TICKET_TITLE = "Add a one-line tagline to the README";
const TICKET_DESCRIPTION =
  "Add a single-sentence tagline beneath the README's H1. No other changes.";
const MAX_TICKS = 10;

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bs-live-"));
  const git = simpleGit(scratch);
  await git.init();
  await git.addConfig("user.email", "test@example.com", false, "local");
  await git.addConfig("user.name", "Test", false, "local");
  await writeFile(join(scratch, "README.md"), "# Pi Harness\n");
  await git.add("README.md");
  await git.commit("init");
  await git.checkoutLocalBranch(`pi/${TASK}`);
  await scaffoldBrainstorm({ cwd: scratch, taskId: TASK, branch: `pi/${TASK}` });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function makeBus() {
  const eventStore = { append: vi.fn(async () => {}) };
  const jsonl = new JsonlWriter(join(scratch, ".harness", TASK, "brainstorm.jsonl"));
  const bus = new BrainstormEventBus({
    eventStore: eventStore as never,
    jsonl,
    runId: "r-live",
    taskId: TASK,
  });
  return bus;
}

function jsonlPath(): string {
  return join(scratch, ".harness", TASK, "brainstorm.jsonl");
}

function sessionPath(): string {
  return join(scratch, ".harness", TASK, "pi-session.jsonl");
}

async function readEvents(): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(jsonlPath(), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const live = process.env["PI_LIVE"] === "1";

describe.runIf(live)("brainstorm against real Anthropic", () => {
  it(
    "completes one Q&A round end-to-end",
    async () => {
      const store = new ArtifactsStore({ runsDir: scratch });
      const bus = makeBus();
      const phaseModel = DEFAULT_PHASE_MODELS.brainstorm;

      const r1 = await runBrainstorm({
        taskId: TASK,
        cwd: scratch,
        store,
        bus,
        phaseModel,
        sessionPath: sessionPath(),
        createAgentSession,
        ticketTitle: TICKET_TITLE,
        ticketDescription: TICKET_DESCRIPTION,
      });

      expect(r1.ok).toBe(true);
      expect(r1.costUsd).toBeGreaterThan(0);

      const events1 = await readEvents();
      const questions = events1.filter((e) => e.kind === "brainstorm_question");
      expect(questions.length).toBeGreaterThan(0);

      const designAfter1 = await store.readArtifact(scratch, TASK, "design");
      const specAfter1 = await store.readArtifact(scratch, TASK, "spec");
      expect(designAfter1?.fm.status).toBe("draft");
      expect(specAfter1?.fm.status).toBe("draft");

      // Synthesize an answer for every question in the first batch by picking
      // the recommended option (or the first option as fallback).
      const firstBatch = questions;
      for (const q of firstBatch) {
        const opts = (q["options"] as Array<{ id: string; recommended?: boolean }>) ?? [];
        const pick = opts.find((o) => o.recommended === true) ?? opts[0];
        if (!pick) continue;
        await appendFile(
          jsonlPath(),
          JSON.stringify({
            ts: new Date().toISOString(),
            kind: "brainstorm_answer",
            questionId: q["questionId"],
            optionId: pick.id,
          }) + "\n",
        );
      }

      let ready = false;
      let totalCost = r1.costUsd;
      for (let tick = 0; tick < MAX_TICKS; tick += 1) {
        const r = await runBrainstorm({
          taskId: TASK,
          cwd: scratch,
          store,
          bus,
          phaseModel,
          sessionPath: sessionPath(),
          createAgentSession,
          ticketTitle: TICKET_TITLE,
          ticketDescription: TICKET_DESCRIPTION,
        });
        totalCost += r.costUsd;
        if (r.ready) {
          ready = true;
          break;
        }
        // If the agent asked another question, answer it the same way.
        const events = await readEvents();
        const lastAgentIdx = (() => {
          for (let i = events.length - 1; i >= 0; i -= 1) {
            const k = events[i]!.kind;
            if (k === "brainstorm_question" || k === "brainstorm_system") return i;
          }
          return -1;
        })();
        const newQuestions = events
          .slice(0, lastAgentIdx + 1)
          .filter((e) => e.kind === "brainstorm_question")
          .filter((q) => {
            const qid = q["questionId"];
            return !events.some(
              (a) => a.kind === "brainstorm_answer" && a["questionId"] === qid,
            );
          });
        for (const q of newQuestions) {
          const opts = (q["options"] as Array<{ id: string; recommended?: boolean }>) ?? [];
          const pick = opts.find((o) => o.recommended === true) ?? opts[0];
          if (!pick) continue;
          await appendFile(
            jsonlPath(),
            JSON.stringify({
              ts: new Date().toISOString(),
              kind: "brainstorm_answer",
              questionId: q["questionId"],
              optionId: pick.id,
            }) + "\n",
          );
        }
      }

      expect(ready).toBe(true);
      expect(totalCost).toBeGreaterThan(0);

      const designFinal = await store.readArtifact(scratch, TASK, "design");
      const specFinal = await store.readArtifact(scratch, TASK, "spec");
      expect(designFinal?.fm.status).toBe("ready");
      expect(specFinal?.fm.status).toBe("ready");

      // pi-session.jsonl was written and is non-empty.
      expect(existsSync(sessionPath())).toBe(true);
      expect(statSync(sessionPath()).size).toBeGreaterThan(0);
    },
    10 * 60_000,
  );
});
