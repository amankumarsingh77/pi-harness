import type { Phase, PhaseModelConfig } from "@pi-harness/shared";
import type {
  AgentSession,
  AgentSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import type { ArtifactsStore } from "../agents/artifacts-store.js";
import type { DesignSystemStore } from "../agents/design-system-store.js";
import type { MockRenderer } from "../agents/mock-renderer.js";
import type { EventStore } from "../adapters/event-store.js";
import type { PreflightStepStore } from "../adapters/preflight-step-store.js";
import { PhaseEventLogStore } from "../adapters/phase-event-log-store.js";
import { BrainstormEventBus } from "../agents/brainstorm-event-bus.js";
import { runBrainstorm } from "../agents/brainstorm.js";
import { PlanEventBus } from "../agents/plan-event-bus.js";
import { runPlan } from "../agents/plan.js";
import { runCode } from "../agents/code.js";
import { runVerifierSidecar } from "../agents/verifier-sidecar.js";
import { runApiScenario, runUiScenario, runUiVisualScenario } from "../agents/verify-runner.js";
import type { ClaimLedgerStore } from "../adapters/mission-store.js";
import type { ClaimPublisher } from "../agents/plan-tools.js";
import type { GraphifyService } from "../services/graphify-service.js";

// Common deps every phase needs. The orchestrator constructs this once and
// passes it into runPhase.
//
// Brainstorm, plan, code, and verify have real drivers. pr returns a
// structured `not_implemented` until it migrates.
export type PhaseDeps = {
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  // Generic agent session (Phase 2 bridge). Brainstorm uses this; other
  // phases route through it as each is migrated.
  createAgentSession: (opts: AgentSessionOptions) => Promise<AgentSession>;
  store: ArtifactsStore;
  designSystem: DesignSystemStore;
  mockRenderer: MockRenderer;
  eventStore: EventStore;
  preflightSteps?: PreflightStepStore;
  claimLedger?: ClaimLedgerStore;
  claimPublisher?: ClaimPublisher;
  graphify?: GraphifyService;
  graphifyQueryBudget?: number;
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
      const phaseEvents = new PhaseEventLogStore({ events: deps.eventStore });
      const bus = new BrainstormEventBus({
        phaseEvents,
        worktreePath: deps.cwd,
        runId: input.runId,
        taskId: input.taskId,
      });
      const r = await runBrainstorm({
        taskId: input.taskId,
        runId: input.runId,
        cwd: deps.cwd,
        store: deps.store,
        designSystem: deps.designSystem,
        renderer: deps.mockRenderer,
        bus,
        eventStore: deps.eventStore,
        ...(deps.claimLedger !== undefined ? { claimLedger: deps.claimLedger } : {}),
        phaseModel: input.phaseModel,
        sessionPath: input.sessionPath,
        createAgentSession: deps.createAgentSession,
        ...(deps.graphify !== undefined ? { graphify: deps.graphify } : {}),
        ...(deps.graphifyQueryBudget !== undefined ? { graphifyQueryBudget: deps.graphifyQueryBudget } : {}),
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
      const phaseEvents = new PhaseEventLogStore({ events: deps.eventStore });
      const bus = new PlanEventBus({
        phaseEvents,
        worktreePath: deps.cwd,
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
        ...(deps.preflightSteps !== undefined ? { preflightSteps: deps.preflightSteps } : {}),
        phaseModel: input.phaseModel,
        sessionPath: input.sessionPath,
        createAgentSession: deps.createAgentSession,
        ...(deps.graphify !== undefined ? { graphify: deps.graphify } : {}),
        ...(deps.graphifyQueryBudget !== undefined ? { graphifyQueryBudget: deps.graphifyQueryBudget } : {}),
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
        ...(deps.graphify !== undefined ? { graphify: deps.graphify } : {}),
        ...(deps.graphifyQueryBudget !== undefined ? { graphifyQueryBudget: deps.graphifyQueryBudget } : {}),
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
    case "verify": {
      if (!deps.claimLedger) {
        return {
          ok: false,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "verify phase requires claimLedger",
        };
      }
      const result = await runVerifierSidecar({
        taskId: input.taskId,
        runId: input.runId,
        cwd: deps.cwd,
        store: deps.store,
        claimLedger: deps.claimLedger,
        ...(deps.claimPublisher !== undefined
          ? { publishClaimsUpdated: deps.claimPublisher.publishClaimsUpdated }
          : {}),
        runApiScenario,
        runUiScenario,
        runUiVisualScenario,
      });
      const challengedCount = result.verified.filter((item) => !item.ok).length;
      return {
        ok: result.ok,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        ...(result.ok
          ? {}
          : { error: result.error ?? `verifier sidecar challenged ${challengedCount} claim(s)` }),
      };
    }
    case "pr":
      return NOT_IMPLEMENTED(phase);
  }
}
