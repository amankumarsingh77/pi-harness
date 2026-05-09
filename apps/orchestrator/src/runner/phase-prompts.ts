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

// Common deps every phase needs. The orchestrator constructs this once and
// passes it into runPhase.
//
// Today only brainstorm has a real driver. plan / code / verify / pr return a
// structured `not_implemented` until each migrates to `createAgentSession`.
// The legacy `createSession` / `runSubagent` plumbing was removed — its
// runtime stubs always threw, so it had no production callers anyway.
export type PhaseDeps = {
  cwd: string;
  onEvent: (e: PiBridgeEvent) => void;
  // Generic agent session (Phase 2 bridge). Brainstorm uses this; other
  // phases will route through it as each is migrated.
  createAgentSession: (opts: AgentSessionOptions) => Promise<AgentSession>;
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
  // Brainstorm-only today. Computed once per dispatch by the run-loop and
  // threaded down so the agent sees the merged per-phase model config.
  phaseModel?: PhaseModelConfig;
  sessionPath?: string;
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
        cwd: deps.cwd,
        store: deps.store,
        bus,
        phaseModel: input.phaseModel,
        sessionPath: input.sessionPath,
        createAgentSession: deps.createAgentSession,
        ...(input.ticketTitle !== undefined ? { ticketTitle: input.ticketTitle } : {}),
        ...(input.ticketDescription !== undefined
          ? { ticketDescription: input.ticketDescription }
          : {}),
      });
      return {
        ok: r.ok,
        costUsd: r.costUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        ...(r.error !== undefined ? { error: r.error } : {}),
      };
    }
    case "plan":
    case "code":
    case "verify":
    case "pr":
      return NOT_IMPLEMENTED(phase);
  }
}
