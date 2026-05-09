import type { Phase } from "@pi-harness/shared";
import type {
  PiSession,
  PiSessionOptions,
  PiBridgeEvent,
} from "@pi-harness/pi-bridge";
import { mkEvent } from "../domain/events.js";

export type DispatchOptions = {
  runId: string;
  taskId: string;
  phase: Phase;
  cwd: string;
  systemPrompt: string;
  userMessage: string;
  signal?: AbortSignal;
};

export type DispatchResult = {
  ok: boolean;
  finalText?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
};

// Minimal interface the dispatcher needs from EventStore — accepting a
// structural type makes it trivially mockable in tests.
type EventSink = {
  append: (e: ReturnType<typeof mkEvent>) => Promise<void>;
};

type CreateSession = (opts: PiSessionOptions) => Promise<PiSession>;

// Runs one phase: creates a pi session, pumps prompt → result, translates pi
// events into AgentEvents, and records phase_started/phase_ended bookends.
//
// The actual phase prompts (system + user message) are passed in by the
// run-loop. Plan 3 will plug in the real prompts; this dispatcher is prompt-
// agnostic.
export class PiDispatcher {
  private readonly createSession: CreateSession;
  private readonly eventStore: EventSink;

  constructor(deps: { createSession: CreateSession; eventStore: EventSink }) {
    this.createSession = deps.createSession;
    this.eventStore = deps.eventStore;
  }

  async runPhase(opts: DispatchOptions): Promise<DispatchResult> {
    const { runId, taskId, phase, cwd, systemPrompt, userMessage, signal } = opts;

    await this.eventStore.append(
      mkEvent({ runId, taskId, kind: "phase_started", phase }),
    );

    const onEvent = (e: PiBridgeEvent) => {
      // Fire-and-forget; we don't want translation latency to block the LLM.
      void this.eventStore.append(this.translate(runId, taskId, e));
    };

    let session: PiSession | null = null;
    try {
      session = await this.createSession(
        signal === undefined
          ? { cwd, systemPrompt, onEvent }
          : { cwd, systemPrompt, signal, onEvent },
      );
      const result = await session.prompt(userMessage);
      await this.eventStore.append(
        mkEvent({ runId, taskId, kind: "phase_ended", phase, status: "succeeded" }),
      );
      return {
        ok: true,
        finalText: result.finalText,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      };
    } catch (e) {
      const err = e as Error;
      await this.eventStore.append(
        mkEvent({ runId, taskId, kind: "phase_ended", phase, status: "failed" }),
      );
      return {
        ok: false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error: err.message,
      };
    } finally {
      if (session) await session.close();
    }
  }

  private translate(runId: string, taskId: string, e: PiBridgeEvent) {
    switch (e.kind) {
      case "message_delta":
        return mkEvent({ runId, taskId, kind: "message_delta", text: e.text });
      case "tool_call":
        return mkEvent({ runId, taskId, kind: "tool_call", tool: e.tool, input: e.input });
      case "tool_result":
        return mkEvent({ runId, taskId, kind: "tool_result", tool: e.tool, ok: e.ok });
      case "log":
        return mkEvent({ runId, taskId, kind: "log", level: e.level, text: e.text });
    }
  }
}
