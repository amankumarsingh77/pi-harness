import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  AuthError,
  __resetRegistryCache,
  type PiBridgeEvent,
} from "./agent-session.js";
import { __resetAuthCache } from "./auth.js";
import { createFakeAdapter } from "./_test/fake-sdk.js";
import { AuthStorage, SessionManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// The fake-sdk adapter satisfies SdkBoundary structurally and lets each test
// drive the SDK event stream directly. We assert observable outcomes only:
// PiBridgeEvent emissions, the resolved PromptUsage, and AuthError on missing
// credentials. No assertions on internal helpers.

function assistantWithUsage(input: number, output: number, costTotal: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "ok" }],
    api: "anthropic-messages" as never,
    provider: "anthropic" as never,
    model: "claude-opus-4-5",
    usage: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: input + output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
    },
    stopReason: "stop" as const,
    timestamp: 0,
  };
}

const baseModel = { provider: "anthropic", model: "claude-opus-4-5" };

let envDir: string;
let prevCwd: string;
let prevHome: string | undefined;

beforeEach(() => {
  envDir = mkdtempSync(join(tmpdir(), "pi-bridge-env-"));
  prevCwd = process.cwd();
  prevHome = process.env["HOME"];
  process.env["HOME"] = envDir;
  process.chdir(envDir);
  writeFileSync(join(envDir, ".env.harness"), "ANTHROPIC_API_KEY=test-key\n");
  __resetAuthCache();
  __resetRegistryCache();
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = prevHome;
  }
  rmSync(envDir, { recursive: true, force: true });
  __resetAuthCache();
  __resetRegistryCache();
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["OPENAI_API_KEY"];
  delete process.env["CROFAI_API_KEY"];
  vi.restoreAllMocks();
});

describe("createAgentSession", () => {
  it("happy path: prompt resolves with aggregated usage; emits message_delta and turn_end", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );

    const promise = session.prompt("hi");

    adapter.emit({
      type: "message_update",
      message: { role: "assistant" } as never,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "hello",
        partial: {} as never,
      },
    } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(12, 7, 0.0005)],
    } as AgentSessionEvent);

    const usage = await promise;
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 7, costUsd: 0.0005 });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("message_delta");
    expect(kinds).toContain("turn_end");
    const msgDelta = events.find((e) => e.kind === "message_delta");
    expect(msgDelta && "text" in msgDelta && msgDelta.text).toBe("hello");
  });

  it("tool round-trip: emits tool_call and tool_result with structured payloads", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("do it");
    adapter.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "foo",
      args: { x: 1 },
    } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "foo",
      result: { y: 2 },
      isError: false,
    } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(1, 1, 0)],
    } as AgentSessionEvent);
    await p;

    const call = events.find((e) => e.kind === "tool_call");
    const result = events.find((e) => e.kind === "tool_result");
    expect(call).toEqual({ kind: "tool_call", callId: "t1", tool: "foo", input: { x: 1 } });
    expect(result).toEqual({ kind: "tool_result", callId: "t1", tool: "foo", ok: true, output: { y: 2 } });
  });

  it("tool allowlist keeps custom tools available", async () => {
    const adapter = createFakeAdapter();
    await createAgentSession(
      {
        cwd: "/tmp",
        model: baseModel,
        tools: ["read", "write"],
        customTools: [
          {
            name: "submit_questions",
            label: "Submit questions",
            description: "Ask structured questions",
            parameters: {} as never,
            execute: async () => ({ content: [], details: {} }),
          },
        ],
        onEvent: () => {},
      },
      adapter,
    );

    expect(adapter.state.createOpts?.tools).toEqual(["read", "write", "submit_questions"]);
  });

  it("tool error: emits tool_result with ok=false and error payload", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("x");
    adapter.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "foo",
      args: {},
    } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "foo",
      result: { message: "boom" },
      isError: true,
    } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(0, 0, 0)],
    } as AgentSessionEvent);
    await p;
    const result = events.find((e) => e.kind === "tool_result");
    expect(result).toEqual({
      kind: "tool_result",
      callId: "t1",
      tool: "foo",
      ok: false,
      output: { message: "boom" },
    });
  });

  it("terminate-from-tool: agent_end after a terminating tool resolves the prompt", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("stop");
    adapter.emit({ type: "turn_start" } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "submit",
      args: { questions: [] },
    } as AgentSessionEvent);
    adapter.emit({
      type: "tool_execution_end",
      toolCallId: "t1",
      toolName: "submit",
      result: { ok: true },
      isError: false,
    } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(3, 4, 0.001)],
    } as AgentSessionEvent);
    const usage = await p;
    expect(usage.costUsd).toBe(0.001);
  });

  it("legacy maxTurns option does not abort an in-flight prompt", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, maxTurns: 2, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("loop");
    adapter.emit({ type: "turn_start" } as AgentSessionEvent);
    adapter.emit({ type: "turn_start" } as AgentSessionEvent);
    adapter.emit({ type: "turn_start" } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(2, 3, 0.001)],
    } as AgentSessionEvent);

    await expect(p).resolves.toEqual({ inputTokens: 2, outputTokens: 3, costUsd: 0.001 });
    expect(adapter.state.abortCalls).toBe(0);
    expect(events.some((e) => e.kind === "error")).toBe(false);
  });

  it("auth missing: throws AuthError when SDK rejects on missing credential", async () => {
    delete process.env["OPENAI_API_KEY"];
    const adapter = createFakeAdapter();
    // Stub the boundary so create() rejects with an auth-shaped message — same
    // signal the real SDK emits when no API key is configured.
    adapter.create = async () => {
      throw new Error("No API key configured for openai");
    };
    await expect(
      createAgentSession(
        { cwd: "/tmp", model: { provider: "openai", model: "gpt-4" }, onEvent: () => {} },
        adapter,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("single-flight: second prompt while first is in flight throws immediately", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const first = session.prompt("a");
    await expect(session.prompt("b")).rejects.toThrow(/in flight/);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(0, 0, 0)],
    } as AgentSessionEvent);
    await first;
  });

  it("auto_retry_start: translated to a warn log", async () => {
    const adapter = createFakeAdapter();
    const events: PiBridgeEvent[] = [];
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: (e) => events.push(e) },
      adapter,
    );
    const p = session.prompt("x");
    adapter.emit({
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 5,
      delayMs: 1000,
      errorMessage: "overloaded",
    } as AgentSessionEvent);
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(0, 0, 0)],
    } as AgentSessionEvent);
    await p;
    const log = events.find((e) => e.kind === "log");
    expect(log).toBeDefined();
    expect(log && "text" in log && log.text).toContain("auto_retry");
    expect(log && "text" in log && log.text).toContain("overloaded");
  });

  it("aggregates usage across multiple assistant messages in agent_end", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const p = session.prompt("multi");
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(10, 5, 0.002), assistantWithUsage(3, 2, 0.0005)],
    } as AgentSessionEvent);
    const usage = await p;
    expect(usage).toEqual({ inputTokens: 13, outputTokens: 7, costUsd: 0.0025 });
  });

  it("close: disposes underlying SDK session", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    await session.close();
    expect(adapter.state.disposeCalls).toBe(1);
  });

  it("usage scoped per prompt: a second prompt aggregates only its own agent_end", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const p1 = session.prompt("one");
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(10, 1, 0.001)],
    } as AgentSessionEvent);
    const u1 = await p1;
    expect(u1.inputTokens).toBe(10);

    const p2 = session.prompt("two");
    adapter.emit({
      type: "agent_end",
      messages: [assistantWithUsage(4, 2, 0.0002)],
    } as AgentSessionEvent);
    const u2 = await p2;
    expect(u2).toEqual({ inputTokens: 4, outputTokens: 2, costUsd: 0.0002 });
  });

  it("crofai auth missing: AuthError names CROFAI_API_KEY", async () => {
    delete process.env["CROFAI_API_KEY"];
    const adapter = createFakeAdapter();
    await expect(
      createAgentSession(
        { cwd: "/tmp", model: { provider: "crofai", model: "kimi-k2.6" }, onEvent: () => {} },
        adapter,
      ),
    ).rejects.toThrow(/CROFAI_API_KEY/);
  });

  it("crofai auth present: assertCredential passes when CROFAI_API_KEY is set", async () => {
    process.env["CROFAI_API_KEY"] = "test-crofai-key";
    const setRuntimeApiKey = vi.spyOn(AuthStorage.prototype, "setRuntimeApiKey");
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: { provider: "crofai", model: "kimi-k2.6" }, onEvent: () => {} },
      adapter,
    );
    await session.close();
    expect(setRuntimeApiKey).toHaveBeenCalledWith("crofai", "test-crofai-key");
  });

  it("programmatically shares .env.harness CROFAI_API_KEY with AuthStorage", async () => {
    writeFileSync(join(envDir, ".env.harness"), "CROFAI_API_KEY=file-crofai-key\n");
    __resetAuthCache();
    __resetRegistryCache();
    const setRuntimeApiKey = vi.spyOn(AuthStorage.prototype, "setRuntimeApiKey");
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: { provider: "crofai", model: "kimi-k2.6" }, onEvent: () => {} },
      adapter,
    );
    await session.close();
    expect(setRuntimeApiKey).toHaveBeenCalledWith("crofai", "file-crofai-key");
  });

  it("opens persisted sessions with the requested cwd override", async () => {
    const worktreeCwd = join(envDir, "worktree");
    const sessionPath = join(worktreeCwd, ".harness", "task-1", "pi-session-plan.jsonl");
    mkdirSync(join(worktreeCwd, ".harness", "task-1"), { recursive: true });
    const open = vi
      .spyOn(SessionManager, "open")
      .mockImplementation((_path, _sessionDir, cwdOverride) =>
        SessionManager.inMemory(cwdOverride ?? "/wrong-cwd"),
      );

    const session = await createAgentSession({
      cwd: worktreeCwd,
      model: baseModel,
      sessionPath,
      onEvent: () => {},
    });
    await session.close();

    expect(open).toHaveBeenCalledWith(sessionPath, undefined, worktreeCwd);
  });

  it("openai-codex oauth present: assertCredential passes with auth.json token", async () => {
    const authDir = join(envDir, ".pi", "agent");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth" } }));

    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: { provider: "openai-codex", model: "gpt-5.5" }, onEvent: () => {} },
      adapter,
    );
    await session.close();
  });

  it("openai-codex oauth missing: AuthError points to login instead of env key", async () => {
    const adapter = createFakeAdapter();
    await expect(
      createAgentSession(
        { cwd: "/tmp", model: { provider: "openai-codex", model: "gpt-5.5" }, onEvent: () => {} },
        adapter,
      ),
    ).rejects.toThrow(/missing subscription login for openai-codex/);
  });

  it("abort: rejects pending prompt with 'aborted' and forwards to sdk", async () => {
    const adapter = createFakeAdapter();
    const session = await createAgentSession(
      { cwd: "/tmp", model: baseModel, onEvent: () => {} },
      adapter,
    );
    const p = session.prompt("hi");
    await session.abort();
    await expect(p).rejects.toThrow("aborted");
    expect(adapter.state.abortCalls).toBe(1);
  });
});
