import { describe, expect, it } from "vitest";
import { PreflightStepStore } from "../src/adapters/preflight-step-store.js";
import { createBareTestStores } from "./helpers/stores.js";
import type { PreflightStep } from "@pi-harness/shared";

const step = (patch: Partial<PreflightStep> = {}): PreflightStep => ({
  taskId: "task-1",
  runId: "run-1",
  attemptId: "attempt-1",
  subagent: "integration-scanner",
  status: "running",
  required: false,
  artifactPath: "/tmp/research/integration-scanner.md",
  startedAt: new Date("2026-05-27T00:00:00.000Z"),
  endedAt: null,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  error: null,
  fallbackReason: null,
  ...patch,
});

describe("PreflightStepStore", () => {
  it("replays the latest state for each run, attempt, and subagent", async () => {
    const { stateDir } = createBareTestStores();
    const store = new PreflightStepStore({ stateDir });

    await store.upsert(step({ status: "running" }));
    await store.upsert(step({
      status: "fallback_succeeded",
      endedAt: new Date("2026-05-27T00:01:00.000Z"),
      fallbackReason: "timed out",
    }));
    await store.upsert(step({
      subagent: "precedent-locator",
      status: "succeeded",
      endedAt: new Date("2026-05-27T00:02:00.000Z"),
    }));

    expect(await store.latestForRun("run-1")).toMatchObject([
      {
        subagent: "integration-scanner",
        status: "fallback_succeeded",
        fallbackReason: "timed out",
      },
      {
        subagent: "precedent-locator",
        status: "succeeded",
      },
    ]);
  });
});
