import type { AgentSdkAdapter, AgentSdkCreateOptions, AgentSdkSession, AgentSdkEvent } from "../agent-session.js";

export type FakeSdkSessionState = {
  subscribers: ((e: AgentSdkEvent) => void)[];
  promptCalls: { text: string }[];
  abortCalls: number;
  disposeCalls: number;
  createOpts: AgentSdkCreateOptions | null;
  sessionFile: string | undefined;
};

export type FakeAgentSdkAdapter = AgentSdkAdapter & {
  state: FakeSdkSessionState;
  emit: (event: AgentSdkEvent) => void;
  emitMany: (events: AgentSdkEvent[]) => void;
};

export function createFakeAdapter(opts?: { sessionFile?: string }): FakeAgentSdkAdapter {
  const state: FakeSdkSessionState = {
    subscribers: [],
    promptCalls: [],
    abortCalls: 0,
    disposeCalls: 0,
    createOpts: null,
    sessionFile: opts?.sessionFile,
  };

  const emit = (event: AgentSdkEvent): void => {
    for (const sub of state.subscribers) sub(event);
  };

  const session: AgentSdkSession = {
    subscribe(listener) {
      state.subscribers.push(listener);
      return () => {
        const idx = state.subscribers.indexOf(listener);
        if (idx >= 0) state.subscribers.splice(idx, 1);
      };
    },
    async prompt(text) {
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
  };

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
