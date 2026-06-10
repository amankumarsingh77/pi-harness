import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import type { ManagedSessionFactory } from "./phase-session-manager.js";
import { mkEvent } from "../domain/events.js";

// Common deps every phase needs. The orchestrator constructs this once and
// passes it into runPhase.
//
// Brainstorm, plan, code, verify, and pr have real drivers.
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
  sessionFactory?: ManagedSessionFactory;
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
        ...(input.sessionFactory !== undefined ? { sessionFactory: input.sessionFactory } : {}),
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
        ...(input.sessionFactory !== undefined ? { sessionFactory: input.sessionFactory } : {}),
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
        ...(input.sessionFactory !== undefined ? { sessionFactory: input.sessionFactory } : {}),
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
      const verifyTurn = input.sessionFactory
        ? await runManagedPhaseTurn({
            phase: "verify",
            input,
            deps,
            promptText: `Verify task ${input.taskId}. Read the scenario and claim artifacts, then continue with the deterministic verifier sidecar.`,
          })
        : zeroPhaseOutput(true);
      if (!verifyTurn.ok) return verifyTurn;
      const result = await runVerifierSidecar({
        taskId: input.taskId,
        runId: input.runId,
        cwd: deps.cwd,
        store: deps.store,
        claimLedger: deps.claimLedger,
        ...(deps.claimPublisher !== undefined
          ? {
              publishClaimsUpdated: deps.claimPublisher.publishClaimsUpdated.bind(
                deps.claimPublisher,
              ),
            }
          : {}),
        runApiScenario,
        runUiScenario,
        runUiVisualScenario,
      });
      const challengedCount = result.verified.filter((item) => !item.ok).length;
      return {
        ok: result.ok,
        costUsd: verifyTurn.costUsd,
        inputTokens: verifyTurn.inputTokens,
        outputTokens: verifyTurn.outputTokens,
        ...(result.ok
          ? {}
          : { error: result.error ?? `verifier sidecar challenged ${challengedCount} claim(s)` }),
      };
    }
    case "pr": {
      if (!input.phaseModel || !input.sessionFactory) {
        return {
          ok: false,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "pr phase requires phaseModel and sessionFactory",
        };
      }
      if (!input.branch) {
        return {
          ok: false,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          error: "pr phase requires branch",
        };
      }
      const prTurn = await runManagedPhaseTurn({
        phase: "pr",
        input,
        deps,
        promptText: `Prepare pull request creation for task ${input.taskId} on branch ${input.branch}.`,
      });
      if (!prTurn.ok) return prTurn;
      const pushed = await deps.exec("git", ["push", "-u", "origin", input.branch], { cwd: deps.cwd });
      if (!pushed.ok) {
        return {
          ...prTurn,
          ok: false,
          error: `git push failed: ${pushed.stderr ?? "unknown"}`,
        };
      }
      const created = await deps.exec("gh", ["pr", "create", "--fill", "--head", input.branch], { cwd: deps.cwd });
      if (!created.ok) {
        return {
          ...prTurn,
          ok: false,
          error: `gh pr create failed: ${created.stderr ?? "unknown"}`,
        };
      }
      return {
        ...prTurn,
        ok: true,
        prUrl: created.stdout.trim().split("\n").pop() ?? "",
      };
    }
  }
}

async function runManagedPhaseTurn(args: {
  readonly phase: Extract<Phase, "verify" | "pr">;
  readonly input: PhaseInput;
  readonly deps: PhaseDeps;
  readonly promptText: string;
}): Promise<PhaseOutput> {
  if (!args.input.phaseModel || !args.input.sessionFactory) {
    return { ...NOT_IMPLEMENTED(args.phase), error: `${args.phase} phase requires managed session` };
  }
  let session: AgentSession;
  try {
    session = await args.input.sessionFactory.open({ kind: "main" }, {
      cwd: args.deps.cwd,
      model: {
        provider: args.input.phaseModel.provider,
        model: args.input.phaseModel.model,
      },
      ...(args.input.phaseModel.thinkingLevel !== "off"
        ? { thinkingLevel: args.input.phaseModel.thinkingLevel }
        : {}),
      systemPrompt: readPhasePrompt(args.phase),
      onEvent: (event) => forwardPhaseBridgeEvent({
        phase: args.phase,
        event,
        taskId: args.input.taskId,
        runId: args.input.runId,
        deps: args.deps,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: (err as Error).message,
    };
  }
  try {
    const usage = await session.prompt(args.promptText);
    return {
      ok: true,
      costUsd: usage.costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  } catch (err) {
    if (args.input.signal?.aborted || (err as Error).message === "aborted") {
      return {
        ok: false,
        cancelled: true,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    return {
      ok: false,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      error: (err as Error).message,
    };
  } finally {
    await session.close().catch(() => {});
  }
}

function readPhasePrompt(phase: Extract<Phase, "verify" | "pr">): string {
  return readFileSync(fileURLToPath(new URL(`../agents/prompts/${phase}.md`, import.meta.url)), "utf8");
}

function zeroPhaseOutput(ok: boolean): PhaseOutput {
  return {
    ok,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function forwardPhaseBridgeEvent(args: {
  readonly phase: Phase;
  readonly event: PiBridgeEvent;
  readonly taskId: string;
  readonly runId: string;
  readonly deps: PhaseDeps;
}): void {
  if (args.event.kind === "turn_end" || args.event.kind === "error" || args.event.kind === "usage_update") return;
  const base = { runId: args.runId, taskId: args.taskId, subagent: args.phase };
  if (args.event.kind === "message_delta") {
    void args.deps.eventStore.append(mkEvent({ ...base, kind: "message_delta", text: args.event.text })).catch(() => {});
  } else if (args.event.kind === "tool_call") {
    void args.deps.eventStore.append(mkEvent({
      ...base,
      kind: "tool_call",
      callId: args.event.callId,
      tool: args.event.tool,
      input: args.event.input,
    })).catch(() => {});
  } else if (args.event.kind === "tool_result") {
    void args.deps.eventStore.append(mkEvent({
      ...base,
      kind: "tool_result",
      callId: args.event.callId,
      tool: args.event.tool,
      ok: args.event.ok,
      ...(args.event.output !== undefined ? { output: args.event.output } : {}),
    })).catch(() => {});
  } else if (args.event.kind === "log") {
    void args.deps.eventStore.append(mkEvent({
      ...base,
      kind: "log",
      level: args.event.level,
      text: args.event.text,
    })).catch(() => {});
  }
}
