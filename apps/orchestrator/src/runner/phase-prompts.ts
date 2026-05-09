import { join } from "node:path";
import type { Phase } from "@pi-harness/shared";
import type { PiBridgeEvent, PiSession, PiSubagentSpec, PiSubagentResult } from "@pi-harness/pi-bridge";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import type { EventStore } from "../adapters/event-store.js";
import { JsonlWriter } from "../adapters/jsonl-writer.js";
import { BrainstormEventBus } from "../agents/brainstorm-event-bus.js";
import { runBrainstorm } from "../agents/brainstorm.js";
import { runPlan } from "../agents/plan.js";
import { runCode } from "../agents/code.js";
import { runVerify } from "../agents/verify.js";
import { runPr } from "../agents/pr.js";
import { fanoutResearch } from "../agents/plan-fanout.js";
import { runApiScenario, runUiScenario, runUiVisualScenario } from "../agents/verify-runner.js";

// Common deps every phase needs. The orchestrator constructs this once and
// passes it into runPhase.
export type PhaseDeps = {
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  createSession: (opts: {
    cwd: string;
    systemPrompt?: string;
    onEvent: (e: PiBridgeEvent) => void;
  }) => Promise<PiSession>;
  runSubagent: (spec: PiSubagentSpec) => Promise<PiSubagentResult>;
  store: ArtifactsStore;
  eventStore: EventStore;
  exec: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ ok: boolean; stdout: string; stderr?: string }>;
};

export type PhaseInput = {
  taskId: string;
  runId: string;
  // Set when a phase rerun should reuse context (coder retry after verify fail).
  retryHint?: { scenarioId: string; expected: string; actual: string };
  ticketTitle?: string;
  ticketDescription?: string;
  branch?: string; // for pr phase
};

export type PhaseOutput = {
  ok: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  // Phase-specific extras the run-loop forwards into Task fields.
  branch?: string;
  prUrl?: string;
};

// Single dispatch point. The run-loop calls this per phase.
export async function runPhase(
  phase: Phase,
  input: PhaseInput,
  deps: PhaseDeps,
): Promise<PhaseOutput> {
  switch (phase) {
    case "brainstorm": {
      const jsonl = new JsonlWriter(
        join(deps.cwd, ".harness", input.taskId, "brainstorm.jsonl"),
      );
      const bus = new BrainstormEventBus({
        eventStore: deps.eventStore,
        jsonl,
        runId: input.runId,
        taskId: input.taskId,
      });
      const r = await runBrainstorm({
        taskId: input.taskId,
        cwd: deps.cwd,
        store: deps.store,
        bus,
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        ...(r.error !== undefined ? { error: r.error } : {}),
      };
    }
    case "plan": {
      const r = await runPlan({
        taskId: input.taskId,
        cwd: deps.cwd,
        onEvent: deps.onEvent,
        createSession: deps.createSession,
        runSubagent: deps.runSubagent,
        fanoutResearch: ({ cwd, task, runSubagent }) =>
          fanoutResearch({ cwd, task, runSubagent }),
        store: deps.store,
      });
      return mapResultPlan(r);
    }
    case "code": {
      const r = await runCode({
        taskId: input.taskId,
        cwd: deps.cwd,
        onEvent: deps.onEvent,
        createSession: deps.createSession,
        readPlan: (id) => deps.store.readPlan(id),
        ...(input.retryHint ? { retryHint: input.retryHint } : {}),
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        ...(r.error !== undefined ? { error: r.error } : {}),
        ...(r.branch !== undefined ? { branch: r.branch } : {}),
      };
    }
    case "verify": {
      const r = await runVerify({
        taskId: input.taskId,
        runId: input.runId,
        store: deps.store,
        runApiScenario: ({ scenario, proofDir }) => runApiScenario({ scenario, proofDir }),
        runUiScenario: ({ scenario, proofDir }) => runUiScenario({ scenario, proofDir }),
        runUiVisualScenario: ({ scenario, proofDir }) =>
          runUiVisualScenario({ scenario, proofDir }),
      });
      return {
        ok: r.ok,
        costUsd: 0, // verifier is code-only in v1
        inputTokens: 0,
        outputTokens: 0,
        ...(r.firstFailure
          ? { error: `scenario ${r.firstFailure.id} failed: ${r.firstFailure.error}` }
          : {}),
      };
    }
    case "pr": {
      if (!input.branch) {
        return { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, error: "pr phase requires branch" };
      }
      const r = await runPr({
        taskId: input.taskId,
        branch: input.branch,
        cwd: deps.cwd,
        store: deps.store,
        exec: deps.exec,
      });
      if (r.ok) {
        return { ok: true, costUsd: 0, inputTokens: 0, outputTokens: 0, prUrl: r.url };
      }
      return { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, error: r.error };
    }
  }
}

function mapResultPlan(r: {
  ok: boolean;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  error?: string;
}): PhaseOutput {
  return {
    ok: r.ok,
    costUsd: r.totalCostUsd,
    inputTokens: r.totalInputTokens,
    outputTokens: r.totalOutputTokens,
    ...(r.error !== undefined ? { error: r.error } : {}),
  };
}
