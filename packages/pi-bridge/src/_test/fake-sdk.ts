import type {
  AgentSession as SdkAgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import type { SdkBoundary, SdkBoundaryCreateOptions } from "../agent-session.js";

export type FakeSdkSessionState = {
  subscribers: ((e: AgentSessionEvent) => void)[];
  promptCalls: { text: string }[];
  abortCalls: number;
  disposeCalls: number;
  createOpts: SdkBoundaryCreateOptions | null;
  sessionFile: string | undefined;
  isStreaming: boolean;
};

export type FakeAgentSdkAdapter = SdkBoundary & {
  state: FakeSdkSessionState;
  emit: (event: AgentSessionEvent) => void;
  emitMany: (events: AgentSessionEvent[]) => void;
};

// Minimal in-memory fake of the SDK boundary so tests can drive the event
// stream directly without a live model. The session implements the parts of
// SdkAgentSession the bridge actually touches: subscribe, prompt, abort,
// dispose, sessionFile, isStreaming. Other AgentSession surface (model
// cycling, compaction, etc.) is intentionally absent.
export function createFakeAdapter(opts?: { sessionFile?: string }): FakeAgentSdkAdapter {
  const state: FakeSdkSessionState = {
    subscribers: [],
    promptCalls: [],
    abortCalls: 0,
    disposeCalls: 0,
    createOpts: null,
    sessionFile: opts?.sessionFile,
    isStreaming: false,
  };

  const emit = (event: AgentSessionEvent): void => {
    if (event.type === "turn_start") state.isStreaming = true;
    if (event.type === "agent_end") state.isStreaming = false;
    for (const sub of state.subscribers) sub(event);
  };

  const session = {
    subscribe(listener: (event: AgentSessionEvent) => void) {
      state.subscribers.push(listener);
      return () => {
        const idx = state.subscribers.indexOf(listener);
        if (idx >= 0) state.subscribers.splice(idx, 1);
      };
    },
    async prompt(text: string) {
      state.promptCalls.push({ text });
    },
    async abort() {
      state.abortCalls += 1;
    },
    dispose() {
      state.disposeCalls += 1;
    },
    get sessionFile() {
      return state.sessionFile;
    },
    get isStreaming() {
      return state.isStreaming;
    },
  } as unknown as SdkAgentSession;

  return {
    state,
    emit,
    emitMany(events) {
      for (const e of events) emit(e);
    },
    async create(createOpts) {
      state.createOpts = createOpts;
      return { session };
    },
  };
}
