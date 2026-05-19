import { join } from "node:path";
import type { Phase, PhaseModelConfig } from "@pi-harness/shared";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import type { EventStore } from "../adapters/event-store.js";
import { JsonlWriter } from "../adapters/jsonl-writer.js";
import { BrainstormEventBus } from "../agents/brainstorm-event-bus.js";
import { runBrainstorm } from "../agents/brainstorm.js";
import { PlanEventBus } from "../agents/plan-event-bus.js";
import { runPlan } from "../agents/plan.js";
import { runCode } from "../agents/code.js";
import type { ClaimLedgerStore } from "../adapters/mission-store.js";
import type { ClaimPublisher } from "../agents/plan-tools.js";

// Common deps every phase needs. The orchestrator constructs this once and
// passes it into runPhase.
//
// Brainstorm, plan, and code have real drivers. verify / pr return a
// structured `not_implemented` until each migrates to `createAgentSession`.
// The legacy `createSession` / `runSubagent` plumbing was removed — its
// runtime stubs always threw, so it had no production callers anyway.
export type PhaseDeps = {
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  // Generic agent session (Phase 2 bridge). Brainstorm uses this; other
  // phases route through it as each is migrated.
  createAgentSession: (opts: AgentSessionOptions) => Promise<AgentSession>;
  store: ArtifactsStore;
  eventStore: EventStore;
  claimLedger?: ClaimLedgerStore;
  claimPublisher?: ClaimPublisher;
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
  // Brainstorm-only today. Computed once per dispatch by the run-loop and
  // threaded down so the agent sees the merged per-phase model config.
  phaseModel?: PhaseModelConfig;
  sessionPath?: string;
  // Cooperative cancellation. Aborted when user_cancel lands while the phase
  // is mid-flight; long-running drivers (brainstorm) tear down their session
  // immediately rather than waiting on the LLM stream to finish.
  signal?: AbortSignal;
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
  // True when the phase ended because the user cancelled the task. The
  // run-loop uses this to skip the failed-phase event/transition path: the
  // route handler already settled the run and emitted phase_ended cancelled.
  cancelled?: boolean;
};

const NOT_IMPLEMENTED = (phase: Phase): PhaseOutput => ({
  ok: false,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  error: `${phase} phase not migrated to the real bridge yet`,
});

// Single dispatch point. The run-loop calls this per phase.
export async function runPhase(
  phase: Phase,
  input: PhaseInput,
  deps: PhaseDeps,
): Promise<PhaseOutput> {
  switch (phase) {
    case "brainstorm": {
      if (!input.phaseModel || !input.sessionPath) {
        return {
          ok: false,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "brainstorm phase requires phaseModel and sessionPath",
        };
      }
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
        runId: input.runId,
        cwd: deps.cwd,
        store: deps.store,
        bus,
        eventStore: deps.eventStore,
        ...(deps.claimLedger !== undefined ? { claimLedger: deps.claimLedger } : {}),
        phaseModel: input.phaseModel,
        sessionPath: input.sessionPath,
        createAgentSession: deps.createAgentSession,
        ...(input.ticketTitle !== undefined ? { ticketTitle: input.ticketTitle } : {}),
        ...(input.ticketDescription !== undefined
          ? { ticketDescription: input.ticketDescription }
          : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        ...(r.error !== undefined ? { error: r.error } : {}),
        ...(r.cancelled ? { cancelled: true } : {}),
      };
    }
    case "plan": {
      if (!input.phaseModel || !input.sessionPath || !input.ticketTitle || !input.ticketDescription) {
        return {
          ok: false,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "plan phase requires phaseModel, sessionPath, ticketTitle, and ticketDescription",
        };
      }
      const jsonl = new JsonlWriter(
        join(deps.cwd, ".harness", input.taskId, "plan.jsonl"),
      );
      const bus = new PlanEventBus({
        eventStore: deps.eventStore,
        jsonl,
        runId: input.runId,
        taskId: input.taskId,
      });
      const r = await runPlan({
        taskId: input.taskId,
        runId: input.runId,
        cwd: deps.cwd,
        store: deps.store,
        bus,
        eventStore: deps.eventStore,
        phaseModel: input.phaseModel,
        sessionPath: input.sessionPath,
        createAgentSession: deps.createAgentSession,
        ticketTitle: input.ticketTitle,
        ticketDescription: input.ticketDescription,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        ...(deps.claimLedger !== undefined ? { claimLedger: deps.claimLedger } : {}),
        ...(deps.claimPublisher !== undefined ? { claimPublisher: deps.claimPublisher } : {}),
        // claim-verifier cap is per tick (one runPlan invocation). The cap
        // protects against a perpetual mark_ready loop within a single turn;
        // across ticks the agent has to recover its own way.
        claimVerifierState: { attempts: 0, cap: 2 },
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        ...(r.error !== undefined ? { error: r.error } : {}),
        ...(r.cancelled ? { cancelled: true } : {}),
      };
    }
    case "code": {
      if (!input.phaseModel) {
        return {
          ok: false,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "code phase requires phaseModel",
        };
      }
      const r = await runCode({
        taskId: input.taskId,
        runId: input.runId,
        cwd: deps.cwd,
        store: deps.store,
        eventStore: deps.eventStore,
        phaseModel: input.phaseModel,
        createAgentSession: deps.createAgentSession,
        ...(input.ticketTitle !== undefined ? { ticketTitle: input.ticketTitle } : {}),
        ...(input.ticketDescription !== undefined
          ? { ticketDescription: input.ticketDescription }
          : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        ...(r.error !== undefined ? { error: r.error } : {}),
        ...(r.cancelled ? { cancelled: true } : {}),
      };
    }
    case "verify":
    case "pr":
      return NOT_IMPLEMENTED(phase);
  }
}
